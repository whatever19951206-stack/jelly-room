import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { JellyBlocksModel, SHAPES, cells } from './jelly-blocks-model.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const BEST_KEY = 'jelly-room.blocks.best.v1';
const FRUIT = {
 I:{name:'薄荷冻',color:'#55bdb5'}, J:{name:'蓝莓冻',color:'#7294d5'},
 L:{name:'蜜橙冻',color:'#eca35b'}, O:{name:'柠檬冻',color:'#e2c555'},
 S:{name:'青提冻',color:'#92b96b'}, T:{name:'葡萄冻',color:'#b58ccd'},
 Z:{name:'西瓜冻',color:'#de8294'},
};
const PATHS = {
 back:'<path d="m14 5-7 7 7 7M7 12h13"/>', pause:'<path d="M8 5v14M16 5v14"/>',
 play:'<path d="m8 4 12 8-12 8Z"/>', restart:'<path d="M4 10a8 8 0 1 1 0 5M4 4v6h6"/>',
 left:'<path d="m14 5-7 7 7 7M7 12h12"/>',right:'<path d="m10 5 7 7-7 7M17 12H5"/>',
 rotate:'<path d="M4 10a8 8 0 1 1 2 8M4 4v6h6"/>', down:'<path d="M12 4v15m-7-6 7 7 7-7"/>',
 drop:'<path d="m6 4 6 6 6-6m-12 6 6 6 6-6M5 21h14"/>',
 hold:'<path d="M3 7h16m-4-4 4 4-4 4M21 17H5m4-4-4 4 4 4"/>',
 sound:'<path d="m11 5-5 4H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
 mute:'<path d="m11 5-5 4H3v6h3l5 4ZM16 9l6 6m0-6-6 6"/>',
};
const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || PATHS.play}</svg>`;
const number = value => Math.floor(value || 0).toLocaleString('zh-CN');

function loadBest(){
 try{const data=JSON.parse(localStorage.getItem(BEST_KEY)||'{}');return {score:clamp(Number(data.score)||0,0,1e12),lines:clamp(Number(data.lines)||0,0,1e8)};}catch{return {score:0,lines:0};}
}

/** A self-contained, lazily rendered game. The host owns requestAnimationFrame. */
export class JellyBlocksGame {
 constructor({onExit=()=>{},onSound=()=>{}}={}){
  this.onExit=onExit;this.onSound=onSound;this._visible=false;this.soundEnabled=true;
  this.best=loadBest();this.sessionBest=this.best.score;this.heldInputs=new Map();this.lastHorizontal='right';
  this.visuals=new Map();this.particles=[];this.flashes=[];this.eventLog=[];this.time=0;this.frames=0;this.pointerCaptures=new Map();
  this.renderer=null;this.scene=null;this.camera=null;this.gesture=null;this._hudKey='';this._overlayStatus='';this._comboUntil=0;
  this.reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  this.root=document.createElement('section');this.root.id='jelly-blocks-screen';this.root.hidden=true;
  this.root.setAttribute('aria-label','果冻方块游戏');
  this.root.innerHTML=`
   <header class="jb-topbar"><button id="jb-exit" class="jb-back" data-jb-action="exit">${svg('back')}<span>返回小店</span></button><span class="jb-wordmark"><i>j.</i> JELLY ROOM <small>SOFT ARCADE / 02</small></span><div class="jb-top-actions"><button id="jb-sound" data-jb-action="sound" aria-label="关闭果冻方块声音" title="声音 · M">${svg('sound')}</button><button id="jb-pause" data-jb-action="pause" aria-label="暂停游戏" title="暂停 · P / Esc">${svg('pause')}</button><button id="jb-restart-top" data-jb-action="restart" aria-label="重新开局" title="重新开局">${svg('restart')}</button></div></header>
   <div class="jb-layout"><aside class="jb-left"><div class="jb-heading"><span>THE SOFTEST WAY TO FALL</span><h1>果冻方块<span>。</span></h1><p>让每一格，都软着陆。</p></div><section class="jb-score-card" aria-label="分数"><span class="jb-label">这一局 / SCORE</span><strong id="jb-score">0</strong><div class="jb-best-row"><span>最好的一次</span><b id="jb-best">0</b></div></section><div class="jb-small-stats"><div><span>等级</span><strong id="jb-level">01</strong></div><div><span>消行</span><strong id="jb-lines">00</strong></div></div><button id="jb-hold-preview" class="jb-hold-preview" data-jb-action="hold" aria-label="暂存或交换方块，快捷键 C"><span class="jb-panel-label">暂存一块 <kbd>C</kbd></span><span id="jb-held-piece" class="jb-held-piece"></span><small id="jb-hold-caption">给下一步，留点余地</small></button><p class="jb-keyboard-note"><span><kbd>← →</kbd> 移动 <kbd>↑ / Z</kbd> 旋转</span><span><kbd>↓</kbd> 轻落 <kbd>空格</kbd> 直落</span><span><kbd>C</kbd> 暂存 <kbd>P / Esc</kbd> 暂停</span></p></aside>
   <div class="jb-stage"><canvas id="jb-canvas" tabindex="0" aria-label="10 列 20 行的三维果冻方块棋盘，方向键移动，上键旋转，空格落下"></canvas><div class="jb-board-caption">10 × 20 <i></i> 一排满格，就会绽开。</div><div id="jb-combo" class="jb-combo" role="status" aria-live="polite"></div><div id="jb-overlay" class="jb-overlay"></div></div>
   <aside class="jb-right"><div class="jb-panel-label jb-next-title">接下来 <span>NEXT</span></div><div id="jb-next-list" class="jb-next-list"></div><div class="jb-active-flavor"><i id="jb-fruit-dot"></i><span id="jb-fruit-name">七种柔软，轮流登场</span></div><p class="jb-soft-note">摆一摆，轻轻落下。<br>消掉一行，心情也松一点。</p></aside></div>
   <nav class="jb-touch-controls" aria-label="触控操作">${[
    ['left','左移','←'],['right','右移','→'],['rotate','旋转','↑'],['down','轻落','↓'],['drop','直落','Space'],['hold','暂存','C'],
   ].map(([action,label,key])=>`<button id="jb-${action}" class="jb-control ${action==='drop'?'jb-control-drop':''}" data-jb-control="${action}" aria-label="${label}" aria-keyshortcuts="${key==='←'?'ArrowLeft':key==='→'?'ArrowRight':key==='↑'?'ArrowUp':key==='↓'?'ArrowDown':key}">${svg(action)}<span>${label}</span></button>`).join('')}</nav>`;
  document.body.append(this.root);this.canvas=this.root.querySelector('#jb-canvas');this.stage=this.root.querySelector('.jb-stage');
  this.model=new JellyBlocksModel({onEvent:event=>this._onEvent(event)});
  this._bindInputs();this._updateHUD();
  this.resizeObserver=new ResizeObserver(()=>{if(this._visible)this.resize();});this.resizeObserver.observe(this.stage);
 }

 get active(){return this._visible;}
 get state(){return {...this.model.snapshot(),activeMode:this._visible,bestScore:this.best.score,soundEnabled:this.soundEnabled,heldInputs:[...this.heldInputs.keys()],render:{ready:!!this.renderer&&!this.renderError,frames:this.frames,blocks:this.visuals.size,particles:this.particles.length,width:this.canvas.width,height:this.canvas.height},lastEvents:this.eventLog.map(event=>({...event}))};}
 get debug(){const r=this.canvas.getBoundingClientRect();return {...this.state,canvasRect:{x:r.x,y:r.y,width:r.width,height:r.height}};}

 open(){
  this._visible=true;this.root.hidden=false;this._releaseInputs();
  if(!this.renderer&&!this.renderError)this._initRenderer();
  this.resize();this._overlayStatus='';this._updateHUD();this._syncCells();this._renderFrame(0);
 }
 close(){
  this._releaseInputs();if(this.model.status==='playing')this.model.pause();
  this._saveBest();this._visible=false;this.root.hidden=true;
 }
 resize(){
  if(!this.renderer||!this._visible)return;
  const r=this.stage.getBoundingClientRect();if(r.width<1||r.height<1)return;
  const width=Math.round(r.width),height=Math.round(r.height),ratio=Math.min(devicePixelRatio||1,1.7);
  if(this._width===width&&this._height===height&&this._ratio===ratio)return;
  this._width=width;this._height=height;this._ratio=ratio;
  this.renderer.setPixelRatio(ratio);this.renderer.setSize(width,height,false);
  const aspect=width/height,viewHeight=Math.max(22.8,11.8/aspect);
  this.camera.left=-viewHeight*aspect/2;this.camera.right=viewHeight*aspect/2;this.camera.top=viewHeight/2;this.camera.bottom=-viewHeight/2;this.camera.updateProjectionMatrix();
  this.cellPixels=height/viewHeight;
 }
 frame(dtSeconds){
  if(!this._visible)return;
  const dt=clamp(Number.isFinite(dtSeconds)?dtSeconds:0,0,.05);
  if(this.model.status==='playing'){this._repeatInputs(dt);this.model.tick(dt*1000);}
  this._updateHUD();this._syncCells();
  this._renderFrame(this.model.status==='paused'?0:dt);
 }

 _sound(name,detail={}){if(this.soundEnabled&&this._visible)this.onSound(name,{intensity:1,...detail});}
 _saveBest(){
  const score=Math.max(this.best.score,this.model.score),lines=Math.max(this.best.lines,this.model.lines);
  if(score===this.best.score&&lines===this.best.lines)return;
  this.best={score,lines};try{localStorage.setItem(BEST_KEY,JSON.stringify(this.best));}catch{/* A private/offline browser can still play. */}
 }
 _start(){
  this._releaseInputs();this.sessionBest=this.best.score;this._comboUntil=0;this.root.querySelector('#jb-combo').classList.remove('show');
  this.model.start();this._updateHUD();this._syncCells();this.canvas.focus({preventScroll:true});
 }
 _togglePause(reason='manual'){
  this._releaseInputs();this.pauseReason=reason;
  if(this.model.status==='playing')this.model.pause();else if(this.model.status==='paused'){this.model.resume();this.canvas.focus({preventScroll:true});}
  this._updateHUD();
 }
 _autoPause(reason){if(!this._visible)return;this._releaseInputs();this.pauseReason=reason;if(this.model.status==='playing')this.model.pause();this._updateHUD();}

 _bindInputs(){
  this.root.addEventListener('click',event=>{
   const button=event.target.closest('button');if(!button||button.disabled)return;
   const control=button.dataset.jbControl;
   if(control){if(event.detail===0)this._perform(control);return;}
   const action=button.dataset.jbAction;
   if(action==='start'||action==='restart')this._start();
   else if(action==='resume'){if(this.model.status==='paused')this._togglePause();}
   else if(action==='pause')this._togglePause();
   else if(action==='exit'){this.close();this.onExit();}
   else if(action==='hold')this._perform('hold');
   else if(action==='sound'){this.soundEnabled=!this.soundEnabled;this._updateHUD();}
  });
  this.root.addEventListener('pointerdown',event=>{
   const control=event.target.closest('[data-jb-control]');if(!control||event.button!==0)return;
   event.preventDefault();control.setPointerCapture(event.pointerId);this.pointerCaptures.set(event.pointerId,control);
   this._press(control.dataset.jbControl,`pointer:${event.pointerId}`);control.classList.add('pressed');
  });
  const releasePointer=event=>{this.pointerCaptures.delete(event.pointerId);this._releaseSource(`pointer:${event.pointerId}`);event.target.closest?.('[data-jb-control]')?.classList.remove('pressed');};
  this.root.addEventListener('pointerup',releasePointer);this.root.addEventListener('pointercancel',releasePointer);this.root.addEventListener('lostpointercapture',releasePointer);
  this.root.addEventListener('contextmenu',event=>event.preventDefault());
  this.canvas.addEventListener('pointerdown',event=>{
   if(event.button!==0||this.model.status!=='playing'||this.gesture)return;
   event.preventDefault();this.canvas.setPointerCapture(event.pointerId);this.pointerCaptures.set(event.pointerId,this.canvas);
   this.gesture={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,accumX:0,accumY:0,start:performance.now(),moved:false};
  });
  this.canvas.addEventListener('pointermove',event=>{
   const g=this.gesture;if(!g||g.id!==event.pointerId||this.model.status!=='playing')return;
   const step=Math.max(12,(this.cellPixels||25)*.8);g.accumX+=event.clientX-g.lastX;g.accumY+=event.clientY-g.lastY;g.lastX=event.clientX;g.lastY=event.clientY;
   while(Math.abs(g.accumX)>=step){const direction=Math.sign(g.accumX);this._perform(direction>0?'right':'left');g.accumX-=direction*step;g.moved=true;}
   while(g.accumY>=step){this._perform('down');g.accumY-=step;g.moved=true;}
  });
  const releaseGesture=event=>{
   const g=this.gesture;if(!g||g.id!==event.pointerId)return;this.gesture=null;
   if(event.type!=='pointerup'||this.model.status!=='playing')return;
   const dx=event.clientX-g.x,dy=event.clientY-g.y,duration=performance.now()-g.start;
   if(dy>Math.max(55,(this.cellPixels||25)*2.5)&&Math.abs(dx)<Math.max(40,(this.cellPixels||25)*1.8)&&duration<300)this._perform('drop');
   else if(!g.moved&&Math.hypot(dx,dy)<12)this._perform('rotate');
  };
  this.canvas.addEventListener('pointerup',releaseGesture);this.canvas.addEventListener('pointercancel',releaseGesture);this.canvas.addEventListener('lostpointercapture',releaseGesture);
  const keyActions={ArrowLeft:'left',ArrowRight:'right',ArrowDown:'down',ArrowUp:'rotate',KeyZ:'rotateBack',Space:'drop',KeyC:'hold'};
  document.addEventListener('keydown',event=>{
   if(!this._visible)return;event.stopImmediatePropagation();
   if(event.ctrlKey||event.metaKey||event.altKey)return;
   if(event.code==='Tab')return;
   if(event.code==='KeyP'||event.code==='Escape'){event.preventDefault();if(!event.repeat)this._togglePause();return;}
   if(event.code==='KeyM'){event.preventDefault();if(!event.repeat){this.soundEnabled=!this.soundEnabled;this._updateHUD();}return;}
   if(event.code==='Enter'){
    if(event.target instanceof HTMLButtonElement)return;
    event.preventDefault();if(!event.repeat){if(this.model.status==='ready'||this.model.status==='over')this._start();else if(this.model.status==='paused')this._togglePause();}return;
   }
   const action=keyActions[event.code];if(!action)return;event.preventDefault();if(event.repeat)return;
   if(this.model.status==='ready'&&event.code==='Space'){this._start();return;}
   this._press(action,`key:${event.code}`);
  },true);
  document.addEventListener('keyup',event=>{if(!this._visible)return;event.stopImmediatePropagation();if(keyActions[event.code]){event.preventDefault();this._releaseSource(`key:${event.code}`);}},true);
  addEventListener('blur',()=>this._autoPause('blur'));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this._autoPause('hidden');});
  this.canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();this._autoPause('context');this.renderError='画面暂时歇了一下。恢复后，可以接着玩。';this._updateHUD();});
  this.canvas.addEventListener('webglcontextrestored',()=>{this.renderError=null;this._overlayStatus='';this.resize();this._updateHUD();});
 }
 _perform(action){
  if(this.model.status!=='playing'||this.renderError)return false;
  if(action==='left')return this.model.move(-1);if(action==='right')return this.model.move(1);
  if(action==='down')return this.model.softDrop();if(action==='rotate')return this.model.rotate(1);
  if(action==='rotateBack')return this.model.rotate(-1);if(action==='drop')return this.model.hardDrop();if(action==='hold')return this.model.hold();
  return false;
 }
 _press(action,source){
  if(this.model.status!=='playing')return;
  if(!['left','right','down'].includes(action)){this._perform(action);return;}
  if(action==='left'||action==='right')this.lastHorizontal=action;
  let held=this.heldInputs.get(action);if(!held){held={sources:new Set(),elapsed:0,next:action==='down'?.045:.16};this.heldInputs.set(action,held);this._perform(action);}held.sources.add(source);
 }
 _releaseSource(source){for(const [action,held] of this.heldInputs){held.sources.delete(source);if(!held.sources.size)this.heldInputs.delete(action);}}
 _releaseInputs(){
  this.heldInputs.clear();this.gesture=null;
  for(const [id,element] of this.pointerCaptures){if(element.hasPointerCapture(id))element.releasePointerCapture(id);}this.pointerCaptures.clear();
  this.root.querySelectorAll('[data-jb-control]').forEach(button=>button.classList.remove('pressed'));
 }
 _repeatInputs(dt){
  for(const [action,held] of this.heldInputs){
   if((action==='left'||action==='right')&&this.heldInputs.has(action==='left'?'right':'left')&&action!==this.lastHorizontal)continue;
   held.elapsed+=dt;let count=0;while(held.elapsed>=held.next&&count++<5){this._perform(action);held.next+=action==='down'?.042:.055;}
  }
 }

 _onEvent(event){
  this.eventLog.push({type:event.type,count:event.count,distance:event.distance});if(this.eventLog.length>12)this.eventLog.shift();
  if(event.type==='reset'){this._clearVisuals();this._releaseInputs();this._hudKey='';}
  if(event.type==='move'&&event.dx){for(let i=0;i<4;i++){const v=this.visuals.get(`${event.piece.id}:${i}`);if(v)v.shearV+=event.dx*1.1;}this._sound('move',{intensity:.35});}
  if(event.type==='rotate'){for(let i=0;i<4;i++){const v=this.visuals.get(`${event.piece.id}:${i}`);if(v){v.twistV-=event.dir*1.7;v.shearV+=event.dir*.9;}}this._sound('rotate',{intensity:.65});}
  if(event.type==='hardDrop'){
   for(let i=0;i<4;i++){const v=this.visuals.get(`${event.piece.id}:${i}`);if(v){v.velocity.y=-Math.min(80,15+event.distance*4);v.dropDistance=event.distance;}}
   this._sound('drop',{distance:event.distance,intensity:Math.min(1,.35+event.distance/20)});
  }
  if(event.type==='lock'){
   for(const cell of event.cells){const v=this.visuals.get(cell.id);if(v)v.landImpulse=event.reason==='hardDrop'?3.8:2.2;}
   if(event.reason!=='hardDrop')this._sound('lock',{intensity:.6});
  }
  if(event.type==='clear'){
   for(const cell of event.removedCells)this._burst(cell);
   for(const cell of event.movedCells){const v=this.visuals.get(cell.id);if(v){v.landImpulse=2.6;v.velocity.y=-2;}}
   for(const row of event.clearedRows)this._rowFlash(row);
   this._comboUntil=this.time+1.8;const label=['','轻轻化开','两行绽开','三行连绽','四行，刚刚好！'][event.count]||'软乎乎的连消';
   const combo=this.root.querySelector('#jb-combo');combo.innerHTML=`<strong>${label}</strong><span>+${number(event.scoreDelta)}${event.combo>0?` · ${event.combo+1} 连消`:''}${event.backToBack?' · 连续四消':''}</span>`;combo.classList.add('show');
   this._sound('clear',{lines:event.count,combo:event.combo,intensity:.7+event.count*.12});
  }
  if(event.type==='hold')this._sound('hold',{intensity:.55});
  if(event.type==='start')this._sound('start',{intensity:.7});
  if(event.type==='pause')this._sound('pause',{intensity:.25});
  if(event.type==='gameover'){this._releaseInputs();this._sound('over',{intensity:.65});}
 }

 _preview(type,tag){
  if(!type)return `<span class="jb-empty-hold">＋</span>`;
  const shape=SHAPES[type][0],minX=Math.min(...shape.map(p=>p.x)),minY=Math.min(...shape.map(p=>p.y)),width=Math.max(...shape.map(p=>p.x))-minX+1,height=Math.max(...shape.map(p=>p.y))-minY+1;
  const color=FRUIT[type].color,id=`jb-${tag}-${type}`;
  return `<svg class="jb-preview-svg" viewBox="0 0 ${width*20+8} ${height*20+10}" aria-label="${FRUIT[type].name}，${type} 形方块"><defs><linearGradient id="${id}" x1="0" y1="0" x2=".75" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".58"/><stop offset=".4" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".9"/></linearGradient></defs>${shape.map(p=>{const x=(p.x-minX)*20+4,y=(p.y-minY)*20+3;return `<rect x="${x+1}" y="${y+3}" width="18" height="18" rx="5" fill="#69725a" opacity=".12"/><rect x="${x}" y="${y}" width="18" height="18" rx="5" fill="${color}"/><rect x="${x}" y="${y}" width="18" height="18" rx="5" fill="url(#${id})"/><path d="M${x+5} ${y+4}h6" stroke="#fff" stroke-opacity=".48" stroke-width="2" stroke-linecap="round"/>`;}).join('')}</svg>`;
 }
 _updateHUD(){
  this._saveBest();const m=this.model,key=[m.score,m.lines,m.level,m.held,m.holdUsed,m.queue.slice(0,5).join(''),m.status,this.best.score,this.soundEnabled,m.active?.type,this.renderError].join('|');
  if(key!==this._hudKey){
   this._hudKey=key;this.root.dataset.status=m.status;
   for(const [id,value] of [['jb-score',number(m.score)],['jb-best',number(this.best.score)],['jb-level',String(m.level).padStart(2,'0')],['jb-lines',String(m.lines).padStart(2,'0')]])this.root.querySelector(`#${id}`).textContent=value;
   this.root.querySelector('#jb-held-piece').innerHTML=this._preview(m.held,'held');
   this.root.querySelector('#jb-hold-caption').textContent=m.holdUsed?'落下这一块后，可以再换':'给下一步，留点余地';
   this.root.querySelector('#jb-hold-preview').disabled=m.holdUsed||m.status!=='playing';
   this.root.querySelector('#jb-hold').disabled=m.holdUsed||m.status!=='playing';
   this.root.querySelector('#jb-pause').disabled=!['playing','paused'].includes(m.status);
   this.root.querySelector('#jb-pause').innerHTML=svg(m.status==='paused'?'play':'pause');
   this.root.querySelector('#jb-pause').setAttribute('aria-label',m.status==='paused'?'继续游戏':'暂停游戏');
   this.root.querySelector('#jb-next-list').innerHTML=m.queue.slice(0,5).map((type,index)=>`<div class="jb-next-card"><span>${String(index+1).padStart(2,'0')}</span>${this._preview(type,`next-${index}`)}<small>${FRUIT[type].name}</small></div>`).join('');
   this.root.querySelector('#jb-fruit-name').textContent=m.active?FRUIT[m.active.type].name:'七种柔软，轮流登场';
   this.root.querySelector('#jb-fruit-dot').style.background=m.active?FRUIT[m.active.type].color:'#bac4a8';
   this.root.querySelector('#jb-sound').innerHTML=svg(this.soundEnabled?'sound':'mute');
   this.root.querySelector('#jb-sound').setAttribute('aria-label',this.soundEnabled?'关闭果冻方块声音':'开启果冻方块声音');
   this.root.querySelector('#jb-sound').setAttribute('aria-pressed',String(!this.soundEnabled));
  }
  const status=this.renderError?'error':m.status;if(status===this._overlayStatus)return;this._overlayStatus=status;
  const overlay=this.root.querySelector('#jb-overlay');overlay.hidden=status==='playing';
  if(status==='playing')return;
  let content;
  if(status==='ready')content=`<span class="jb-dialog-kicker">A LITTLE SOFT CHALLENGE</span><h2>叠起来，<br>再轻轻化开。</h2><p>摆好七种果冻方块。<br>填满一整行，就能软乎乎地消掉。</p><div class="jb-ready-tip"><span>← → 移动 · ↑ 旋转</span><span>空格直落 · C 暂存</span><small>触屏也能轻点旋转、左右拖动。</small></div><button id="jb-start" class="jb-primary" data-jb-action="start">开始这一局 ${svg('play')}</button>`;
  else if(status==='paused')content=`<span class="jb-dialog-kicker">YOUR JELLIES CAN WAIT</span><h2>歇一小会。</h2><p>${this.pauseReason==='hidden'||this.pauseReason==='blur'?'离开画面时，已帮你暂停。<br>':'这一局好好地留在这里。<br>'}准备好了，再接着摆。</p><button id="jb-resume" class="jb-primary" data-jb-action="resume">继续刚才这一局 ${svg('play')}</button><button id="jb-restart" class="jb-dialog-secondary" data-jb-action="restart">重新开一局</button>`;
  else if(status==='error')content=`<span class="jb-dialog-kicker">A SMALL TECHNICAL PAUSE</span><h2>画面歇了一下。</h2><p>${this.renderError}</p><button class="jb-primary" data-jb-action="exit">回到小店 ${svg('back')}</button>`;
  else content=`<span class="jb-dialog-kicker">ONE MORE SOFT MOMENT</span><h2>这一局，<br>收好了。</h2><div class="jb-final-score">${number(m.score)}<span>本局得分${m.score>this.sessionBest?' · 新的最好成绩':''}</span></div><p>消掉 ${m.lines} 行 · 到达 ${m.level} 级<br>下一次，会更从容一点。</p><button id="jb-restart" class="jb-primary" data-jb-action="restart">再来一局 ${svg('restart')}</button><button class="jb-dialog-secondary" data-jb-action="exit">今天先收工</button>`;
  overlay.innerHTML=`<section class="jb-dialog" role="dialog" aria-modal="true" aria-label="${status==='ready'?'开始游戏':status==='paused'?'游戏暂停':status==='over'?'本局结束':'画面提示'}">${content}</section>`;
  if(this._visible)queueMicrotask(()=>overlay.querySelector('.jb-primary')?.focus({preventScroll:true}));
 }

 _initRenderer(){
  try{
   this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,antialias:true,alpha:true,powerPreference:'high-performance'});
   const renderer=this.renderer;renderer.setClearColor('#edeae2',0);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
   this.scene=new THREE.Scene();this.camera=new THREE.OrthographicCamera(-7,7,12,-12,.1,100);this.camera.position.set(5.2,13.1,40);this.camera.lookAt(0,9.9,0);
   const room=new RoomEnvironment(),lightPanel=new THREE.Mesh(new THREE.BoxGeometry(4,.1,3),new THREE.MeshBasicMaterial({color:new THREE.Color(3,3,3)}));lightPanel.position.set(-3,6,0);room.add(lightPanel);const pmrem=new THREE.PMREMGenerator(renderer);this.environment=pmrem.fromScene(room,.035);this.scene.environment=this.environment.texture;this.scene.environmentIntensity=.9;room.dispose();pmrem.dispose();
   this.scene.add(new THREE.HemisphereLight('#fff9e9','#b2b5a2',1.15));
   const key=new THREE.DirectionalLight('#fff9ec',2.7);key.position.set(-9,24,17);key.castShadow=true;key.shadow.mapSize.set(1024,2048);Object.assign(key.shadow.camera,{left:-8,right:8,top:13,bottom:-13,near:.5,far:60});key.target.position.set(0,10,0);key.shadow.normalBias=.025;key.shadow.bias=-.00015;key.shadow.radius=3;this.scene.add(key,key.target);
   const fill=new THREE.DirectionalLight('#e9f2ff',.8);fill.position.set(10,8,9);this.scene.add(fill);
   const boardMaterial=new THREE.MeshStandardMaterial({color:'#e7e5d9',roughness:.68,metalness:0});
   const rim=new THREE.Mesh(new RoundedBoxGeometry(10.94,20.94,.65,4,.26),new THREE.MeshPhysicalMaterial({color:'#f5f2e7',roughness:.32,clearcoat:.55}));rim.position.set(0,10,-.89);rim.castShadow=true;rim.receiveShadow=true;this.scene.add(rim);
   const board=new THREE.Mesh(new RoundedBoxGeometry(10.24,20.24,.3,3,.17),boardMaterial);board.position.set(0,10,-.47);board.receiveShadow=true;this.scene.add(board);
   const lines=[];for(let x=-5;x<=5;x++)lines.push(x,0,-.302,x,20,-.302);for(let y=0;y<=20;y++)lines.push(-5,y,-.302,5,y,-.302);
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));this.scene.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#a7b397',transparent:true,opacity:.27})));
   const foot=new THREE.Mesh(new RoundedBoxGeometry(11.55,.68,2.6,4,.25),new THREE.MeshPhysicalMaterial({color:'#e5e3d6',roughness:.46,clearcoat:.3}));foot.position.set(0,-.68,-.58);foot.castShadow=true;foot.receiveShadow=true;this.scene.add(foot);
   const floor=new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.ShadowMaterial({color:'#6c735a',opacity:.12}));floor.rotation.x=-Math.PI/2;floor.position.y=-1.04;floor.receiveShadow=true;this.scene.add(floor);
   this.blockGeometry=new RoundedBoxGeometry(.932,.932,.75,4,.155);
   this.bubbleGeometry=new THREE.SphereGeometry(.032,7,5);this.bubbleMaterial=new THREE.MeshBasicMaterial({color:'#fff8ec',transparent:true,opacity:.3,depthWrite:false});
   this.shineGeometry=new RoundedBoxGeometry(.32,.042,.022,2,.018);this.shineMaterial=new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.31,depthWrite:false});
   this.materials={};this.particleMaterials={};for(const [type,fruit] of Object.entries(FRUIT)){this.materials[type]=new THREE.MeshPhysicalMaterial({color:fruit.color,roughness:.145,metalness:0,clearcoat:1,clearcoatRoughness:.065,transmission:.13,thickness:.9,ior:1.43,attenuationColor:fruit.color,attenuationDistance:2.2,envMapIntensity:1.3});this.particleMaterials[type]=new THREE.MeshStandardMaterial({color:fruit.color,roughness:.22,metalness:0});}
   this.particleGeometry=new RoundedBoxGeometry(1,1,1,2,.24);
   this.ghosts=[];const ghostMaterial=new THREE.MeshBasicMaterial({color:'#93ab7b',transparent:true,opacity:.12,depthWrite:false}),outlineMaterial=new THREE.LineBasicMaterial({color:'#829c6d',transparent:true,opacity:.48,depthWrite:false});
   const ghostGeometry=new RoundedBoxGeometry(.92,.92,.035,3,.13),outlinePoints=[];for(let corner=0;corner<4;corner++){const angle=corner*Math.PI/2,cx=Math.cos(angle+Math.PI/4)*.47,cy=Math.sin(angle+Math.PI/4)*.47;for(let i=0;i<=5;i++){const a=angle+i/5*Math.PI/2;outlinePoints.push(new THREE.Vector3(cx+Math.cos(a)*.12,cy+Math.sin(a)*.12,.025));}}
   for(let i=0;i<4;i++){const group=new THREE.Group(),mesh=new THREE.Mesh(ghostGeometry,ghostMaterial);group.add(mesh);const outline=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(outlinePoints),outlineMaterial);group.add(outline);group.visible=false;this.scene.add(group);this.ghosts.push(group);}
  }catch(error){this.renderError='请使用支持 WebGL 2 的新版浏览器，并开启硬件加速。';this._overlayStatus='';this._updateHUD();}
 }

 _world(cell){return new THREE.Vector3(cell.x-4.5,19.5-cell.y,.13);}
 _createVisual(id,type,cell,settled=false){
  const group=new THREE.Group(),mesh=new THREE.Mesh(this.blockGeometry,this.materials[type]);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  const shine=new THREE.Mesh(this.shineGeometry,this.shineMaterial);shine.position.set(-.15,.29,.365);shine.rotation.z=.12;group.add(shine);
  for(let n=0;n<2;n++){const bubble=new THREE.Mesh(this.bubbleGeometry,this.bubbleMaterial);bubble.position.set(n?.24:-.23,n?-.17:-.06,.366);bubble.scale.setScalar(n?.7:1);group.add(bubble);}
  this.scene.add(group);const target=this._world(cell),position=target.clone();if(!settled&&!this.reducedMotion)position.y+=.28;
  const visual={id,type,group,position,target,velocity:new THREE.Vector3(),squash:0,squashV:0,shear:0,shearV:0,twist:0,twistV:0,settled,landImpulse:0,row:cell.y};this.visuals.set(id,visual);return visual;
 }
 _syncCells(){
  if(!this.renderer||this.renderError)return;
  const wanted=new Map(),m=this.model;
  for(let y=0;y<20;y++)for(let x=0;x<10;x++){const cell=m.board[y][x];if(cell)wanted.set(cell.id,{x,y,type:cell.type,settled:true});}
  if(m.active)cells(m.active).forEach((cell,index)=>wanted.set(`${m.active.id}:${index}`,{...cell,type:m.active.type,settled:false}));
  if(m.status==='ready'){
   const types=['S','S','O','O','T','T','T','L','L','J','S','O','O','T','Z','Z','L','J','J','J'];
   for(let n=0;n<20;n++){const x=n%10,y=19-Math.floor(n/10);if([10,14,18].includes(n))continue;wanted.set(`demo-${n}`,{x,y,type:types[n],settled:true});}
   [[0,17,'I'],[1,17,'I'],[2,17,'I'],[3,17,'I'],[7,17,'L']].forEach(([x,y,type],index)=>wanted.set(`demo-top-${index}`,{x,y,type,settled:true}));
  }
  for(const [id,cell] of wanted){const visual=this.visuals.get(id)||this._createVisual(id,cell.type,cell,cell.settled);visual.target.copy(this._world(cell));visual.settled=cell.settled;visual.row=cell.y;visual.group.visible=cell.y>=0&&cell.y<20;}
  for(const [id,visual] of this.visuals)if(!wanted.has(id)){this.scene.remove(visual.group);this.visuals.delete(id);}
  const ghost=m.status==='playing'?m.getGhostCells():[];
  this.ghosts.forEach((group,index)=>{const cell=ghost[index];group.visible=!!cell&&cell.y>=0;if(cell){group.position.copy(this._world(cell));group.position.z=-.23;}});
 }
 _clearVisuals(){
  if(this.scene){for(const visual of this.visuals.values())this.scene.remove(visual.group);for(const item of [...this.particles,...this.flashes]){this.scene.remove(item.mesh);if(item.ownedMaterial){item.mesh.material.dispose();item.mesh.geometry.dispose();}}}
  this.visuals.clear();this.particles.length=0;this.flashes.length=0;
 }
 _burst(cell){
  if(!this.renderer||this.reducedMotion)return;const origin=this._world(cell);
  for(let n=0;n<5&&this.particles.length<180;n++){
   const seed=cell.x*13+cell.y*29+n*7,angle=seed*2.399,mesh=new THREE.Mesh(this.particleGeometry,this.particleMaterials[cell.type]);
   mesh.position.copy(origin);mesh.position.z+=.35;mesh.castShadow=false;this.scene.add(mesh);
   this.particles.push({mesh,velocity:new THREE.Vector3(Math.cos(angle)*(1+n*.2),1.8+Math.sin(seed)*1.2,1+Math.cos(seed)*.7),spin:new THREE.Vector3(.8+n,1.5-n*.2,2),age:0,life:.6+n*.07,size:.075+n*.018});
  }
 }
 _rowFlash(row){
  if(!this.renderer)return;const material=new THREE.MeshBasicMaterial({color:'#fff4c6',transparent:true,opacity:.35,depthWrite:false}),mesh=new THREE.Mesh(new THREE.PlaneGeometry(10,.92),material);mesh.position.set(0,19.5-row,.58);this.scene.add(mesh);this.flashes.push({mesh,age:0,life:.32,ownedMaterial:true});
 }
 _renderFrame(dt){
  if(!this.renderer||this.renderError||!this._visible)return;
  this.time+=dt;
  for(const visual of this.visuals.values()){
   const v=visual;if(this.reducedMotion){v.position.copy(v.target);v.squash=v.shear=v.twist=0;}
   else if(dt>0){
    const steps=Math.max(1,Math.ceil(dt/.012)),step=dt/steps;
    for(let s=0;s<steps;s++){
     for(const axis of ['x','y','z']){v.velocity[axis]+=((v.target[axis]-v.position[axis])*190-v.velocity[axis]*22)*step;v.position[axis]+=v.velocity[axis]*step;}
     if(v.settled&&v.position.y<v.target.y-.13){v.position.y=v.target.y-.13;v.velocity.y=Math.abs(v.velocity.y)*.25;}
     if(v.landImpulse&&Math.abs(v.position.y-v.target.y)<.23){v.squashV-=v.landImpulse;v.shearV+=(Number(String(v.id).split(':')[1])%2?.25:-.25);v.landImpulse=0;}
     v.squashV+=(-155*v.squash-13*v.squashV)*step;v.squash=clamp(v.squash+v.squashV*step,-.26,.18);
     v.shearV+=(-135*v.shear-12*v.shearV)*step;v.shear=clamp(v.shear+v.shearV*step,-.2,.2);
     v.twistV+=(-140*v.twist-14*v.twistV)*step;v.twist=clamp(v.twist+v.twistV*step,-.22,.22);
    }
   }
   v.group.position.copy(v.position);v.group.rotation.z=v.twist;v.group.scale.set(1-v.squash*.5,1+v.squash,1-v.squash*.35);v.group.updateMatrix();v.group.matrix.elements[4]+=v.shear;v.group.matrixAutoUpdate=false;
  }
  for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.age+=dt;if(p.age>=p.life){this.scene.remove(p.mesh);this.particles.splice(i,1);continue;}p.velocity.y-=10*dt;p.mesh.position.addScaledVector(p.velocity,dt);p.mesh.rotation.x+=p.spin.x*dt;p.mesh.rotation.y+=p.spin.y*dt;p.mesh.rotation.z+=p.spin.z*dt;p.mesh.scale.setScalar(p.size*Math.pow(1-p.age/p.life,.6));}
  for(let i=this.flashes.length-1;i>=0;i--){const flash=this.flashes[i];flash.age+=dt;if(flash.age>=flash.life){this.scene.remove(flash.mesh);flash.mesh.geometry.dispose();flash.mesh.material.dispose();this.flashes.splice(i,1);continue;}flash.mesh.material.opacity=.35*(1-flash.age/flash.life);}
  if(this._comboUntil&&this.time>this._comboUntil){this.root.querySelector('#jb-combo').classList.remove('show');this._comboUntil=0;}
  this.renderer.render(this.scene,this.camera);this.frames++;
 }
}

export default JellyBlocksGame;
