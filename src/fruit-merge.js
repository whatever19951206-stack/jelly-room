import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FruitMergeModel, FRUITS, SLICE_PROFILES, spawnAngle, spawnY, WIDTH, HEIGHT, DANGER_Y } from './fruit-merge-model.js';

const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const ease=t=>t*t*(3-2*t);
const BEST_KEY='jelly-room.fruit-merge.best.v1';
const COLORS=FRUITS.map(fruit=>fruit.color);
const SVG={back:'<path d="m14 5-7 7 7 7M7 12h13"/>',pause:'<path d="M8 5v14M16 5v14"/>',play:'<path d="m8 4 12 8-12 8Z"/>',restart:'<path d="M4 10a8 8 0 1 1 0 5M4 4v6h6"/>',left:'<path d="m14 5-7 7 7 7M7 12h12"/>',right:'<path d="m10 5 7 7-7 7M17 12H5"/>',drop:'<path d="M12 3v15m-6-6 6 6 6-6M5 22h14"/>',sound:'<path d="m11 5-5 4H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',mute:'<path d="m11 5-5 4H3v6h3l5 4ZM16 9l6 6m0-6-6 6"/>'};
const svg=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${SVG[name]||SVG.play}</svg>`;
const number=value=>Math.floor(value||0).toLocaleString('zh-CN');
function best(){try{return clamp(Number(localStorage.getItem(BEST_KEY))||0,0,1e12);}catch{return 0;}}

// Only the original three pieces: a thick rounded grape block, orange slice, and watermelon wedge.
function icon(level,id='slice'){
 const flavor=FRUITS[level]?.sliceFlavor||'grape',color=COLORS[level],gradient=`fm-${id}-${level}`,scale=id==='family'?(.57+.43*level/10):1;
 let side='',face='',details='';
 if(flavor==='melon'){
  side='<path d="M32 13 7 35A34 34 0 0 0 57 35Z" fill="#24512d"/>';
  face=`<path d="M32 7 7 29A34 34 0 0 0 57 29Z" fill="#2d6532"/><path d="M32 7 8.5 27.7A32 32 0 0 0 55.5 27.7Z" fill="#efebbe"/><path d="M32 7 10.2 26.2A29.7 29.7 0 0 0 53.8 26.2Z" fill="url(#${gradient})"/>`;
  for(const [x,y,a] of [[32,18,0],[25,23,-25],[38,23,25],[20,28,-40],[28,29,-15],[36,29,15],[44,28,40]])details+=`<ellipse cx="${x}" cy="${y}" rx="1" ry="1.8" fill="#492d29" transform="rotate(${a} ${x} ${y})"/>`;
 }else if(flavor==='citrus'){
  side='<ellipse cx="32" cy="35" rx="26" ry="22.7" fill="#d87808"/>';
  face=`<ellipse cx="32" cy="28" rx="26" ry="22.7" fill="#e99915"/><ellipse cx="32" cy="28" rx="24" ry="20.9" fill="#ffe6a0"/><ellipse cx="32" cy="28" rx="21.9" ry="19.1" fill="url(#${gradient})"/>`;
  for(let i=0;i<10;i++){const a=i/10*TAU,x=32+Math.cos(a)*21.5,y=28+Math.sin(a)*18.7;details+=`<path d="M32 28  ${x} ${y}" stroke="#ffdb87" stroke-width="1.3" opacity=".95"/>`;}
  details+='<circle cx="32" cy="28" r="2.6" fill="#ffe6a0"/>';
 }else{
  side='<rect x="8" y="13" width="48" height="45" rx="9" fill="#6a3b9b"/>';
  face=`<rect x="8" y="6" width="48" height="45" rx="10" fill="url(#${gradient})"/>`;
  details='<path d="M10 42Q11 49 21 49H44Q54 48 54 39" stroke="#eddbff" stroke-width="1.4" fill="none" opacity=".48"/><circle cx="24" cy="27" r="1" fill="#f0d8fa" opacity=".5"/><circle cx="42" cy="36" r=".8" fill="#f0d8fa" opacity=".4"/>';
 }
 return `<svg class="fm-fruit-icon" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${gradient}" x1=".15" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".68"/><stop offset=".45" stop-color="${color}"/><stop offset="1" stop-color="${color}"/></linearGradient></defs><g transform="translate(32 32) scale(${scale}) translate(-32 -32)"><ellipse cx="33" cy="59" rx="24" ry="3" fill="#536342" opacity=".12"/>${side}${face}${details}<path d="M15 22Q16 15 24 14" fill="none" stroke="#fff9df" stroke-width="2.5" stroke-linecap="round" opacity=".5"/></g></svg>`;
}
/** A 2D fruit garden with genuinely deforming 3D skins. The host owns its animation frame. */
export class FruitMergeGame{
 constructor({onExit=()=>{},onSound=()=>{}}={}){
  this.onExit=onExit;this.onSound=onSound;this._visible=false;this.soundEnabled=true;this.bestScore=best();this.sessionBest=this.bestScore;
  this.renderer=null;this.visuals=new Map();this.ghosts=[];this.particles=[];this.fusions=[];this.heldInputs=new Map();this.pointerCaptures=new Map();this.activePointers=new Set();this.gesture=null;this.cancelledGesture=false;
  this.time=0;this.frames=0;this.eventLog=[];this._hudKey='';this._overlayStatus='';this._lastContactSound=-10;this._toastUntil=0;this._maxIndent=0;this._deformPoint=new THREE.Vector3();this.reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  this.root=document.createElement('section');this.root.id='fruit-merge-screen';this.root.hidden=true;this.root.setAttribute('aria-label','水果果冻合成游戏');
  this.root.innerHTML=`<header class="fm-topbar"><button id="fm-exit" class="fm-back" data-fm-action="exit">${svg('back')}<span>返回小店</span></button><div class="fm-wordmark"><i>j.</i><span>JELLY ROOM</span><small>JELLY SLICES / 03</small></div><div class="fm-top-actions"><button id="fm-sound" data-fm-action="sound" aria-label="关闭水果果冻声音" title="声音 · M">${svg('sound')}</button><button id="fm-pause" data-fm-action="pause" aria-label="暂停游戏" title="暂停 · P / Esc">${svg('pause')}</button><button id="fm-restart-top" data-fm-action="restart" aria-label="重新开局">${svg('restart')}</button></div></header>
   <main class="fm-layout"><aside class="fm-left"><div class="fm-heading"><span>A LITTLE GARDEN OF SLICES</span><h1>软软大西瓜<span>。</span></h1><p>碰一碰，<br>长成更大的甜。</p></div><section class="fm-score-card" aria-label="分数"><span class="fm-label">这一篮的甜 / SCORE</span><strong id="fm-score">0</strong><div class="fm-best"><span>最好的一篮</span><b id="fm-best">0</b></div></section><div class="fm-next-card"><span class="fm-label">下一片 <small>NEXT</small></span><div id="fm-next-icon"></div><span id="fm-next-name">蜜橙小片</span></div><div class="fm-goal"><span class="fm-label">今天的小目标</span><strong>合出一片大西瓜</strong><div class="fm-goal-progress"><i id="fm-goal-bar"></i></div><small id="fm-goal-caption">从一片小果冻开始。</small></div><p class="fm-keyboard"><span><kbd>← →</kbd> 调整位置</span><span><kbd>空格 / Enter</kbd> 轻轻放下</span><span><kbd>P / Esc</kbd> 暂停 · <kbd>M</kbd> 声音</span></p></aside>
   <div class="fm-stage"><canvas id="fm-canvas" tabindex="0" aria-label="三维果冻切片篮，左右移动选择落点，点击或松手放下切片，相同大小、同口味的切片碰到后合成"></canvas><div id="fm-warning" class="fm-warning" role="status" aria-live="polite"><span>篮子快满啦</span><b id="fm-warning-time">3.0</b><small>快把上面的切片合起来</small></div><div class="fm-stage-note"><span id="fm-current-name">葡萄小片</span><i></i><span id="fm-drop-hint">按住移动 · 松手放下</span></div><div id="fm-merge-toast" class="fm-merge-toast" role="status" aria-live="polite"></div><div id="fm-overlay" class="fm-overlay"></div></div>
   <aside class="fm-right"><div class="fm-growth-title"><span>一片片，变大</span><small>THE SLICE FAMILY</small></div><ol id="fm-family" class="fm-family">${FRUITS.map((fruit,level)=>`<li data-level="${level}" class="${level===10?'fm-family-goal':''}"><span class="fm-family-number">${String(level+1).padStart(2,'0')}</span>${icon(level,'family')}<span>${fruit.name}</span><i></i></li>`).join('')}</ol><p class="fm-soft-note">压下去，会软。<br>碰一起，会长大。</p></aside></main>
   <nav class="fm-touch-controls" aria-label="触控操作"><button id="fm-left" data-fm-control="left" aria-label="向左调整落点">${svg('left')}</button><button id="fm-drop" data-fm-control="drop">${svg('drop')}<span>轻轻放下</span><kbd>SPACE</kbd></button><button id="fm-right" data-fm-control="right" aria-label="向右调整落点">${svg('right')}</button></nav>`;
  document.body.append(this.root);this.canvas=this.root.querySelector('#fm-canvas');this.stage=this.root.querySelector('.fm-stage');
  this.model=new FruitMergeModel({onEvent:event=>this._onEvent(event)});this._bindInputs();this._updateHUD();this.resizeObserver=new ResizeObserver(()=>{if(this._visible)this.resize();});this.resizeObserver.observe(this.stage);
 }
 get active(){return this._visible;}
 get state(){
  const snapshot=this.model.snapshot(),r=this.canvas.getBoundingClientRect();
  const deformationBodies=[...this.visuals.values()].map(v=>({id:v.id,indent:Number((v.maxVertexDisplacement||0).toFixed(4)),wobble:Number(Math.abs(v.wobble).toFixed(4))}));
  return {...snapshot,activeMode:this._visible,bestScore:this.bestScore,soundEnabled:this.soundEnabled,heldInputs:[...this.heldInputs.keys()],render:{ready:!!this.renderer&&!this.renderError,frames:this.frames,fruits:this.visuals.size,particles:this.particles.length,fusions:this.fusions.length,width:this.canvas.width,height:this.canvas.height,deformations:deformationBodies.filter(v=>v.indent>.001).length,deformationBodies,maxIndent:this._maxIndent,drawCalls:this.renderer?.info.render.calls||0,projection:{left:r.left,top:r.top,width:r.width,height:r.height,zero:this.project(0,0),x10:this.project(WIDTH,0),y14:this.project(0,HEIGHT)}},lastEvents:this.eventLog.map(event=>({...event}))};
 }
 get debug(){return this.state;}
 project(x,y){if(!this.camera)return null;const p=new THREE.Vector3(x-WIDTH/2,y,0).project(this.camera),r=this.canvas.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};}
 open(){this._visible=true;this.root.hidden=false;this._releaseInputs();if(!this.renderer&&!this.renderError)this._initRenderer();this.resize();this._overlayStatus='';this._updateHUD();this._syncVisuals();this._renderFrame(0);}
 close(){this._releaseInputs();if(this.model.status==='playing')this.model.pause();this._saveBest();this._visible=false;this.root.hidden=true;}
 resize(){
  if(!this.renderer||!this._visible)return;const r=this.stage.getBoundingClientRect();if(r.width<1||r.height<1)return;
  const width=Math.round(r.width),height=Math.round(r.height),ratio=Math.min(devicePixelRatio||1,1.65);if(this._width===width&&this._height===height&&this._ratio===ratio)return;this._width=width;this._height=height;this._ratio=ratio;this.renderer.setPixelRatio(ratio);this.renderer.setSize(width,height,false);
  const aspect=width/height,viewHeight=Math.max(15.6,11.7/aspect);this.camera.left=-viewHeight*aspect/2;this.camera.right=viewHeight*aspect/2;this.camera.top=viewHeight/2;this.camera.bottom=-viewHeight/2;this.camera.updateProjectionMatrix();
 }
 frame(dtSeconds){if(!this._visible)return;const dt=clamp(Number.isFinite(dtSeconds)?dtSeconds:0,0,.05);if(this.model.status==='playing'){this._repeatInputs(dt);this.model.tick(dt);}this._updateHUD();this._syncVisuals();this._renderFrame(this.model.status==='paused'?0:dt);}
 _sound(name,detail={}){if(this._visible&&this.soundEnabled)this.onSound(name,{intensity:1,...detail});}
 _saveBest(){if(this.model.score<=this.bestScore)return;this.bestScore=this.model.score;try{localStorage.setItem(BEST_KEY,String(this.bestScore));}catch{/* A browser that blocks storage can still play. */}}
 _start(){this._releaseInputs();this.sessionBest=this.bestScore;this._clearVisuals();this._toastUntil=0;this.root.querySelector('#fm-merge-toast').classList.remove('show');this.model.start();this._overlayStatus='';this._updateHUD();this._syncVisuals();this.canvas.focus({preventScroll:true});this._sound('start',{intensity:.7});}
 _togglePause(reason='manual'){this._releaseInputs();this.pauseReason=reason;if(this.model.status==='playing')this.model.pause();else if(this.model.status==='paused'){this.model.resume();this.canvas.focus({preventScroll:true});}this._updateHUD();}
 _autoPause(reason){if(!this._visible)return;this._releaseInputs();this.pauseReason=reason;if(this.model.status==='playing')this.model.pause();this._updateHUD();}
 _aim(clientX,clientY){if(!this.camera||this.model.status!=='playing')return;const r=this.canvas.getBoundingClientRect(),p=new THREE.Vector3((clientX-r.left)/r.width*2-1,1-(clientY-r.top)/r.height*2,.5).unproject(this.camera);const direction=this.camera.getWorldDirection(new THREE.Vector3());p.addScaledVector(direction,-p.z/direction.z);this.model.setAim(p.x+WIDTH/2);}
 _perform(action){if(this.model.status!=='playing')return;if(action==='drop'){this.model.drop();return;}this.model.setAim(this.model.aimX+(action==='left'?-.32:.32));}
 _bindInputs(){
  this.root.addEventListener('click',event=>{const button=event.target.closest('button');if(!button||button.disabled||!this._visible)return;const control=button.dataset.fmControl;if(control){if(event.detail===0)this._perform(control);return;}const action=button.dataset.fmAction;if(action==='start'||action==='restart')this._start();else if(action==='resume'&&this.model.status==='paused')this._togglePause();else if(action==='pause')this._togglePause();else if(action==='exit'){this.close();this.onExit();}else if(action==='sound'){this.soundEnabled=!this.soundEnabled;this._updateHUD();}});
  this.root.addEventListener('pointerdown',event=>{const control=event.target.closest('[data-fm-control]');if(!control||event.button!==0||!this._visible||this.model.status!=='playing')return;event.preventDefault();control.setPointerCapture(event.pointerId);this.pointerCaptures.set(event.pointerId,control);control.classList.add('pressed');if(control.dataset.fmControl==='drop')this._perform('drop');else this._press(control.dataset.fmControl,`pointer:${event.pointerId}`);});
  const releaseControl=event=>{this.pointerCaptures.delete(event.pointerId);this._releaseSource(`pointer:${event.pointerId}`);event.target.closest?.('[data-fm-control]')?.classList.remove('pressed');};
  this.root.addEventListener('pointerup',releaseControl);this.root.addEventListener('pointercancel',releaseControl);this.root.addEventListener('lostpointercapture',releaseControl);this.root.addEventListener('contextmenu',event=>event.preventDefault());
  this.canvas.addEventListener('pointerdown',event=>{if(!this._visible||this.model.status!=='playing'||event.button!==0)return;event.preventDefault();this.activePointers.add(event.pointerId);if(this.gesture||this.activePointers.size>1){this.gesture=null;this.cancelledGesture=true;return;}this.cancelledGesture=false;this._aim(event.clientX,event.clientY);this.gesture={id:event.pointerId};this.canvas.setPointerCapture(event.pointerId);this.pointerCaptures.set(event.pointerId,this.canvas);});
  this.canvas.addEventListener('pointermove',event=>{if(!this._visible||this.model.status!=='playing'||this.cancelledGesture)return;if(event.pointerType==='mouse'&&!this.gesture||this.gesture?.id===event.pointerId)this._aim(event.clientX,event.clientY);});
  const releaseGesture=event=>{this.activePointers.delete(event.pointerId);const gesture=this.gesture;if(gesture?.id===event.pointerId){this.gesture=null;if(event.type==='pointerup'&&!this.cancelledGesture&&this._visible&&this.model.status==='playing'){this._aim(event.clientX,event.clientY);this.model.drop();}}if(!this.activePointers.size)this.cancelledGesture=false;};
  this.canvas.addEventListener('pointerup',releaseGesture);this.canvas.addEventListener('pointercancel',releaseGesture);this.canvas.addEventListener('lostpointercapture',event=>{if(this.gesture?.id===event.pointerId)this.gesture=null;this.activePointers.delete(event.pointerId);});
  window.addEventListener('keydown',event=>{if(!this._visible)return;const key=event.code,keys=['ArrowLeft','ArrowRight','Space','Enter','KeyP','Escape','KeyM'];if(!keys.includes(key))return;if(['Space','Enter'].includes(key)&&event.target.closest?.('button'))return;event.preventDefault();event.stopImmediatePropagation();if(['KeyP','Escape'].includes(key)){if(!event.repeat)this._togglePause();return;}if(key==='KeyM'){if(!event.repeat){this.soundEnabled=!this.soundEnabled;this._updateHUD();}return;}if(this.model.status!=='playing')return;if(key==='ArrowLeft'||key==='ArrowRight'){if(!event.repeat)this._press(key==='ArrowLeft'?'left':'right',key);}else if(!event.repeat&&!this.heldInputs.has(key)){this.heldInputs.set(key,{sources:new Set([key])});this._perform('drop');}},true);
  window.addEventListener('keyup',event=>{if(!this._visible)return;if(['ArrowLeft','ArrowRight','Space','Enter','KeyP','Escape','KeyM'].includes(event.code)){event.preventDefault();event.stopImmediatePropagation();this._releaseSource(event.code);this.heldInputs.delete(event.code);}},true);
  window.addEventListener('blur',()=>this._autoPause('blur'));document.addEventListener('visibilitychange',()=>{if(document.hidden)this._autoPause('hidden');});
 }
 _press(action,source){if(this.model.status!=='playing')return;let held=this.heldInputs.get(action);if(!held){held={sources:new Set(),elapsed:0,next:.15};this.heldInputs.set(action,held);this._perform(action);}held.sources.add(source);}
 _releaseSource(source){for(const [action,held] of this.heldInputs){held.sources.delete(source);if(!held.sources.size)this.heldInputs.delete(action);}}
 _releaseInputs(){this.heldInputs.clear();this.gesture=null;this.activePointers.clear();this.cancelledGesture=false;for(const [id,element] of this.pointerCaptures){try{if(element.hasPointerCapture(id))element.releasePointerCapture(id);}catch{/* Pointer may already have been cancelled by the browser. */}}this.pointerCaptures.clear();this.root.querySelectorAll('[data-fm-control]').forEach(button=>button.classList.remove('pressed'));}
 _repeatInputs(dt){for(const [action,held] of this.heldInputs){if(!['left','right'].includes(action))continue;held.elapsed+=dt;let count=0;while(held.elapsed>=held.next&&count++<4){this._perform(action);held.next+=.045;}}}
 _onEvent(event){
  this.eventLog.push({type:event.type,level:event.level??event.body?.level,bodyId:event.bodyId??event.body?.id,scoreDelta:event.scoreDelta,chain:event.chain,intensity:event.intensity});if(this.eventLog.length>18)this.eventLog.shift();
  if(event.type==='reset')this._clearVisuals();
  if(event.type==='drop'){this._sound('drop',{level:event.body?.level,intensity:.6});if(this.preview)this.preview.kick=.12;}
  if(event.type==='contact'){
   for(const [id,sign] of [[event.bodyId,1],[event.otherId,-1]]){const visual=this.visuals.get(id);if(visual){const angle=Math.atan2(-event.ny*sign,-event.nx*sign)-visual.angle,index=((Math.round(angle/TAU*8)%8)+8)%8;visual.dents[index].velocity+=Math.min(4,(event.intensity||Math.min(1,(event.impactSpeed||event.impulse)/8))*3.2);visual.wobbleV+=Math.min(3,(event.intensity||.2)*2);}}
   if((event.impactSpeed||0)>1.1&&this.time-this._lastContactSound>.09){this._lastContactSound=this.time;this._sound('contact',{intensity:clamp(event.intensity||event.impactSpeed/10,.15,.7)});}
  }
  if(event.type==='merge'){
   if(this.renderer){const parents=event.parents||[];for(const parent of parents){const visual=this.visuals.get(parent.id);if(visual){this.visuals.delete(parent.id);this.fusions.push({visual,from:new THREE.Vector3(parent.x-WIDTH/2,parent.y,0),to:new THREE.Vector3(event.body.x-WIDTH/2,event.body.y,0),age:0,life:.25});}}
    const visual=this.visuals.get(event.body.id)||this._createVisual(event.body);visual.bornAt=this.time;visual.wobbleV=3.8;visual.formed=true;this._burst(event.body,event.level===10);
   }
   this._toastUntil=this.time+1.65;const toast=this.root.querySelector('#fm-merge-toast');toast.innerHTML=`<strong>${event.level===10?'一片大西瓜，合成啦！':`${FRUITS[event.level].name}，长大了`}</strong><span>+${number(event.scoreDelta)}${event.chain>1?` · ${event.chain} 连合`:''}</span>`;toast.classList.add('show');this._sound(event.level===10?'watermelon':'merge',{level:event.level,intensity:event.level===10?1:.5+event.level*.035});
  }
  if(event.type==='gameover'||event.type==='over'){this._releaseInputs();this._sound('over',{intensity:.65});}
 }
 _updateControlIcons(){
  // Keep native touch-down targets attached while unrelated scores and cooldowns update.
  const paused=this.model.status==='paused';
  if(this._pauseIconState!==paused){const button=this.root.querySelector('#fm-pause');button.innerHTML=svg(paused?'play':'pause');button.setAttribute('aria-label',paused?'继续游戏':'暂停游戏');this._pauseIconState=paused;}
  if(this._soundIconState!==this.soundEnabled){const button=this.root.querySelector('#fm-sound');button.innerHTML=svg(this.soundEnabled?'sound':'mute');button.setAttribute('aria-label',this.soundEnabled?'关闭水果果冻声音':'开启水果果冻声音');button.setAttribute('aria-pressed',String(!this.soundEnabled));this._soundIconState=this.soundEnabled;}
 }
 _updateHUD(){
  this._saveBest();const m=this.model,key=[m.score,m.highestLevel,m.watermelons,m.currentLevel,m.nextLevel,m.status,m.canDrop,this.bestScore,this.soundEnabled,this.renderError].join('|');
  if(key!==this._hudKey){this._hudKey=key;this.root.dataset.status=m.status;this.root.querySelector('#fm-score').textContent=number(m.score);this.root.querySelector('#fm-best').textContent=number(this.bestScore);this.root.querySelector('#fm-next-icon').innerHTML=icon(m.nextLevel??1,'next');this.root.querySelector('#fm-next-name').textContent=FRUITS[m.nextLevel??1].name;this.root.querySelector('#fm-current-name').textContent=FRUITS[m.currentLevel??0].name;this.root.querySelector('#fm-goal-bar').style.width=`${clamp(m.highestLevel||0,0,10)*10}%`;this.root.querySelector('#fm-goal-caption').textContent=m.watermelons?`已经合出 ${m.watermelons} 片西瓜，继续收集甜。`:`已长到${FRUITS[m.highestLevel||0].name} · 还有 ${10-(m.highestLevel||0)} 次长大`;this.root.querySelectorAll('.fm-family li').forEach(li=>{li.classList.toggle('unlocked',Number(li.dataset.level)<=(m.highestLevel||0));li.classList.toggle('current',Number(li.dataset.level)===(m.highestLevel||0));});this.root.querySelector('#fm-pause').disabled=!['playing','paused'].includes(m.status);this._updateControlIcons();this.root.querySelector('#fm-drop').disabled=m.status!=='playing'||!m.canDrop;this.root.querySelector('#fm-left').disabled=m.status!=='playing';this.root.querySelector('#fm-right').disabled=m.status!=='playing';this.root.querySelector('#fm-drop-hint').textContent=m.status==='playing'&&!m.canDrop?'等它落稳一点':'按住移动 · 松手放下';}
  const warning=m.status==='playing'&&(m.overflowTime||0)>0;this.root.classList.toggle('fm-in-danger',warning);this.root.querySelector('#fm-warning').classList.toggle('show',warning);if(warning)this.root.querySelector('#fm-warning-time').textContent=Math.max(0,m.overflowRemaining||0).toFixed(1);
  const status=this.renderError?'error':m.status;if(status===this._overlayStatus)return;this._overlayStatus=status;const overlay=this.root.querySelector('#fm-overlay');overlay.hidden=status==='playing';if(status==='playing')return;let content;
  if(status==='ready')content=`<span class="fm-dialog-kicker">GROW A LITTLE SWEETNESS</span><h2>一碰，就甜到一起。</h2><p>把果冻切片轻轻放进篮子。<br>两片一样大、同口味的碰到一起，就会长大。</p><div class="fm-ready-family">${icon(0,'ready-a')}<span>＋</span>${icon(0,'ready-b')}<span>→</span>${icon(1,'ready-c')}</div><button id="fm-start" class="fm-primary" data-fm-action="start">开始养这一篮 ${svg('play')}</button><small class="fm-dialog-tip">鼠标 / 手指移动 · 松手放下 · 合出大西瓜</small>`;
  else if(status==='paused')content=`<span class="fm-dialog-kicker">YOUR FRUIT GARDEN CAN WAIT</span><h2>甜的，慢慢来。</h2><p>${['blur','hidden'].includes(this.pauseReason)?'离开画面时，已帮你暂停。':'这一篮切片好好地留在这里。'}<br>准备好了，再接着种。</p><button id="fm-resume" class="fm-primary" data-fm-action="resume">继续这一篮 ${svg('play')}</button><button id="fm-restart" class="fm-secondary" data-fm-action="restart">重新养一篮</button>`;
  else if(status==='error')content=`<span class="fm-dialog-kicker">A LITTLE PAUSE</span><h2>画面歇了一下。</h2><p>${this.renderError}</p><button class="fm-primary" data-fm-action="exit">回到小店 ${svg('back')}</button>`;
  else content=`<span class="fm-dialog-kicker">A BASKET FULL OF SWEET MOMENTS</span><h2>这一篮，收好啦。</h2><div class="fm-final-score">${number(m.score)}<span>本局得分${m.score>this.sessionBest?' · 新的最好成绩':''}</span></div><p>最大的甜：${FRUITS[m.highestLevel||0].name}<br>${m.watermelons?`合出 ${m.watermelons} 片大西瓜`:`完成 ${m.merges||0} 次软软合成`}</p><button id="fm-restart" class="fm-primary" data-fm-action="restart">再养一篮 ${svg('restart')}</button><button class="fm-secondary" data-fm-action="exit">今天先收工</button>`;
  overlay.innerHTML=`<section class="fm-dialog" role="dialog" aria-modal="true" aria-label="${status==='ready'?'开始游戏':status==='paused'?'游戏暂停':status==='over'?'本局结束':'画面提示'}">${content}</section>`;if(this._visible)queueMicrotask(()=>overlay.querySelector('.fm-primary')?.focus({preventScroll:true}));
 }
 _initRenderer(){
  try{
   this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,antialias:true,alpha:true,powerPreference:'high-performance'});const renderer=this.renderer;renderer.setClearColor('#f1eedf',0);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.84;
   this.scene=new THREE.Scene();this.camera=new THREE.OrthographicCamera(-7,7,8,-8,.1,100);this.camera.position.set(3.0,21.7,34);this.camera.lookAt(0,7.1,0);
   const room=new RoomEnvironment();
   // A frontal cut face reflects a softbox in front and below, unlike an entire sphere.
   const panel=new THREE.Mesh(new THREE.BoxGeometry(3.7,.78,.08),new THREE.MeshBasicMaterial({color:new THREE.Color(4,4,4)}));panel.position.set(-1.6,-1.6,6.5);room.add(panel);
   const sidePanel=new THREE.Mesh(new THREE.BoxGeometry(.72,2.8,.08),new THREE.MeshBasicMaterial({color:new THREE.Color(2.0,2.0,2.0)}));sidePanel.position.set(2.8,-.6,6.1);room.add(sidePanel);
   const pmrem=new THREE.PMREMGenerator(renderer);this.environment=pmrem.fromScene(room,.045);this.scene.environment=this.environment.texture;this.scene.environmentIntensity=.63;room.dispose();pmrem.dispose();
   this.scene.add(new THREE.HemisphereLight('#fff8e6','#858570',.63));const key=new THREE.DirectionalLight('#fff7e9',1.75);key.position.set(-8,19,14);key.target.position.set(0,5,0);key.castShadow=true;key.shadow.mapSize.set(1024,2048);Object.assign(key.shadow.camera,{left:-7,right:7,top:9,bottom:-9,near:.5,far:55});key.shadow.normalBias=.035;key.shadow.bias=-.0002;key.shadow.radius=3;this.scene.add(key,key.target);const fill=new THREE.DirectionalLight('#ffffff',.35);fill.position.set(9,5,12);this.scene.add(fill);const rimLight=new THREE.DirectionalLight('#fff2cf',.8);rimLight.position.set(-2,13,-5);this.scene.add(rimLight);
   this._createBasket();this.materials=FRUITS.map((fruit,level)=>this._createMaterial(level));this.darkSeedMaterial=new THREE.MeshPhysicalMaterial({color:'#492d29',roughness:.24,clearcoat:.65});this.bubbleMaterial=new THREE.MeshPhysicalMaterial({color:'#fff9da',transparent:true,opacity:.24,roughness:.2,depthWrite:false});this.bubbleGeometry=new THREE.SphereGeometry(1,7,5);this.seedGeometry=new THREE.SphereGeometry(1,7,5);
   this.preview=this._createPreview();
  }catch(error){console.error('Fruit garden renderer',error);this.renderError='请使用支持 WebGL 2 的新版浏览器，并开启硬件加速。';this._overlayStatus='';this._updateHUD();}
 }
 _createBasket(){
  const ceramic=new THREE.MeshPhysicalMaterial({color:'#e4ead9',roughness:.38,clearcoat:.68});const plate=new THREE.Mesh(new RoundedBoxGeometry(10.85,12.3,.32,5,.42),new THREE.MeshStandardMaterial({color:'#e9eddc',roughness:.8}));plate.position.set(0,6.1,-2.72);plate.receiveShadow=true;this.scene.add(plate);
  const bottom=new THREE.Mesh(new RoundedBoxGeometry(11,.44,4.8,5,.21),ceramic);bottom.position.set(0,-.23,-.15);bottom.castShadow=true;bottom.receiveShadow=true;this.scene.add(bottom);
  const railMaterial=new THREE.MeshPhysicalMaterial({color:'#c1d4bc',roughness:.23,metalness:.12,clearcoat:.9});for(const side of [-1,1]){const rail=new THREE.Mesh(new RoundedBoxGeometry(.14,12.4,.45,4,.064),railMaterial);rail.position.set(side*5.13,6.17,-.04);rail.castShadow=true;this.scene.add(rail);const glass=new THREE.Mesh(new THREE.PlaneGeometry(.17,12),new THREE.MeshBasicMaterial({color:'#fffdf0',transparent:true,opacity:.64,depthWrite:false}));glass.position.set(side*5.09,6.1,.23);this.scene.add(glass);const shadow=new THREE.Mesh(new THREE.PlaneGeometry(.22,12),new THREE.MeshBasicMaterial({color:'#768468',transparent:true,opacity:.08,depthWrite:false}));shadow.position.set(side*4.96,6.02,-2.5);this.scene.add(shadow);}
  const lip=new THREE.Mesh(new RoundedBoxGeometry(10.55,.15,.1,3,.07),new THREE.MeshPhysicalMaterial({color:'#f5f4e7',transparent:true,opacity:.55,roughness:.14,clearcoat:1,depthWrite:false}));lip.position.set(0,.03,2.29);this.scene.add(lip);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.ShadowMaterial({color:'#556746',opacity:.13}));floor.rotation.x=-Math.PI/2;floor.position.y=-.48;floor.receiveShadow=true;this.scene.add(floor);
  const marks=[];for(let x=-4.8;x<=4.8;x+=.43)marks.push(x,DANGER_Y,.12,x+.2,DANGER_Y,.12);const lineGeo=new THREE.BufferGeometry();lineGeo.setAttribute('position',new THREE.Float32BufferAttribute(marks,3));this.dangerLine=new THREE.LineSegments(lineGeo,new THREE.LineBasicMaterial({color:'#9da18b',transparent:true,opacity:.46}));this.scene.add(this.dangerLine);
  const guideGeo=new THREE.BufferGeometry();guideGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,1,0,0,12.8,0],3));this.aimGuide=new THREE.Line(guideGeo,new THREE.LineDashedMaterial({color:'#77945d',transparent:true,opacity:.36,dashSize:.16,gapSize:.18}));this.aimGuide.computeLineDistances();this.scene.add(this.aimGuide);
  this.landingRing=new THREE.Mesh(new THREE.RingGeometry(.2,.235,40),new THREE.MeshBasicMaterial({color:'#75975a',transparent:true,opacity:.4,side:THREE.DoubleSide,depthWrite:false}));this.landingRing.position.z=-2.44;this.scene.add(this.landingRing);
 }
 _createMaterial(level){
  const material=new THREE.MeshPhysicalMaterial({vertexColors:true,color:'#ffffff',roughness:.17,metalness:0,clearcoat:1,clearcoatRoughness:.07,transmission:.17,thickness:1.3,ior:1.46,envMapIntensity:1.15,side:THREE.DoubleSide,attenuationColor:FRUITS[level].color,attenuationDistance:3});material.userData.level=level;return material;
 }
 _sliceColor(flavor,x,y,z,h){
  const color=new THREE.Color(),top=ease(clamp((z+h*.5)/(h*1.35),0,1));
  // Source-coordinate colors from the original shop, including only the watermelon's curved rind.
  if(flavor==='melon'){
   const r=Math.hypot(x,y+2.1),a=Math.atan2(y+2.1,x),stripe=Math.sin(a*33+Math.sin((z+h*.5)*5+a*7)*.62)+Math.sin(a*65+(z+h*.5)*1.8)*.19;
   if(r>4.00){color.set(stripe>.12?'#3d7736':'#164c2c');color.lerp(new THREE.Color('#85a953'),top*.12);}
   else if(r>3.76){color.set('#f3efbc');if(r<3.82)color.lerp(new THREE.Color('#f79c91'),.3);}
   else{color.set('#c71940');const grain=Math.sin(x*58+y*91)*Math.sin(y*51-x*25);color.offsetHSL(grain*.002,0,grain*.009+Math.cos(r*2)*.015);}
  }else if(flavor==='citrus'){
   const r=Math.hypot(x/3.05,y/2.66),a=Math.atan2(y/2.66,x/3.05),segment=Math.abs(Math.sin(a*5));color.set(r>.94?'#e99915':r>.88?'#ffe6a0':r<.095?'#ffd87e':segment<.042&&z>h*.4?'#ffcf6e':'#f18c08');color.offsetHSL(0,0,Math.sin(x*82+y*63)*Math.cos(y*43)*.017);
  }else{color.set('#8856b8');color.offsetHSL(Math.sin(x+y)*.015,Math.sin(x*3-y*2)*.03,Math.cos(x*1.6)*Math.cos(y*1.2)*.045);}
  return color;
 }
 _surfaceRatio(profile,p){
  let ratio=0;for(let i=0;i<profile.outline.length;i++){const a=profile.outline[i],b=profile.outline[(i+1)%profile.outline.length],nx=b.y-a.y,ny=a.x-b.x,support=nx*a.x+ny*a.y;if(Math.abs(support)>1e-8)ratio=Math.max(ratio,(nx*p.x+ny*p.y)/support);}return ratio;
 }
 _sliceFrontZ(v,p){const r=typeof p==='number'?p:this._surfaceRatio(v.profile,p);return v.height*.5+.12*(1-r*r);}
 _containsSlice(profile,p){return this._surfaceRatio(profile,p)<.90;}
 _renderOutline(profile){
  this.outlineCache??=new Map();if(this.outlineCache.has(profile.flavor))return this.outlineCache.get(profile.flavor);
  // Densify the original recipe's curved edges for smooth highlights; the shared collision
  // profile remains the same shape, within a subpixel of these finer decorative arcs.
  const original=[];
  if(profile.flavor==='citrus')for(let i=0;i<80;i++){const a=i/80*TAU;original.push({x:Math.cos(a)*3.05,y:Math.sin(a)*2.66});}
  else if(profile.flavor==='melon'){original.push({x:0,y:-2.1});for(let i=0;i<=40;i++){const a=.74+(Math.PI-1.48)*i/40;original.push({x:Math.cos(a)*4.25,y:Math.sin(a)*4.25-2.1});}}
  else for(let j=0;j<4;j++){const a0=-Math.PI/2+j*Math.PI/2,cx=j<2?1.5:-1.5,cy=j===0||j===3?-1.5:1.5;for(let i=0;i<=10;i++){const a=a0+i/10*Math.PI/2;original.push({x:cx+Math.cos(a)*1.04,y:cy+Math.sin(a)*1.04});}}
  const base=original.map(point=>({x:(point.x-profile.sourceCenter.x)/profile.sourceRadius,y:(point.y-profile.sourceCenter.y)/profile.sourceRadius})),outline=[];
  for(let i=0;i<base.length;i++){const a=base[i],b=base[(i+1)%base.length],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/.075));for(let j=0;j<steps;j++)outline.push({x:lerp(a.x,b.x,j/steps),y:lerp(a.y,b.y,j/steps)});}
  this.outlineCache.set(profile.flavor,outline);return outline;
 }
 _createVisual(body,preview=false){
  const {id,level,radius}=body,flavor=FRUITS[level].sliceFlavor,profile=SLICE_PROFILES[flavor],group=new THREE.Group(),h=({grape:1.42,citrus:1.3,melon:1.22})[flavor]/profile.sourceRadius;
  // Resample the exact shared convex outline; this is also the shape that really collides.
  const outline=this._renderOutline(profile);
  // Rounded, thick side wall and an almost flat, gently domed fresh cut surface.
  const rings=[{s:.012,z:-h*.5},{s:.45,z:-h*.5-.006},{s:.91,z:-h*.5},{s:.982,z:-h*.5+.035},{s:1,z:-h*.5+.07},{s:1.009,z:-h*.14},{s:1.009,z:h*.15},{s:1,z:h*.5-.027},{s:.982,z:h*.5-.003},{s:.95,z:h*.5+.012},{s:.938,z:h*.5+.017},{s:.884,z:h*.5+.026},{s:.871,z:h*.5+.029},{s:.70,z:h*.5+.061},{s:.48,z:h*.5+.092},{s:.29,z:h*.5+.110},{s:.012,z:h*.5+.12}];
  const n=outline.length,points=[],colors=[],indices=[];
  for(const ring of rings)for(const point of outline){const x=point.x*ring.s,y=point.y*ring.s;points.push(x,y,ring.z);const color=this._sliceColor(flavor,x*profile.sourceRadius+profile.sourceCenter.x,y*profile.sourceRadius+profile.sourceCenter.y,ring.z,h);colors.push(color.r,color.g,color.b);}
  for(let r=0;r<rings.length-1;r++)for(let j=0;j<n;j++){const a=r*n+j,b=r*n+(j+1)%n,c=(r+1)*n+j,d=(r+1)*n+(j+1)%n;indices.push(a,b,c,b,d,c);}
  const backCenter=points.length/3;points.push(0,0,-h*.5);let centerColor=this._sliceColor(flavor,profile.sourceCenter.x,profile.sourceCenter.y,-h*.5,h);colors.push(centerColor.r,centerColor.g,centerColor.b);
  const frontCenter=points.length/3;points.push(0,0,h*.5+.12);centerColor=this._sliceColor(flavor,profile.sourceCenter.x,profile.sourceCenter.y,h*.5+.12,h);colors.push(centerColor.r,centerColor.g,centerColor.b);
  for(let j=0;j<n;j++){indices.push(j,backCenter,(j+1)%n);const a=(rings.length-1)*n+j,b=(rings.length-1)*n+(j+1)%n;indices.push(a,b,frontCenter);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  const mesh=new THREE.Mesh(geometry,this.materials[level]);mesh.castShadow=!preview;mesh.receiveShadow=true;group.add(mesh);
  const visual={id,level,radius,flavor,profile,height:h,group,mesh,geometry,original:new Float32Array(points),dents:Array.from({length:8},(_,i)=>({angle:i/8*TAU,value:0,velocity:0,target:0})),wobble:0,wobbleV:0,angle:body.angle||0,formed:false,bornAt:this.time,position:new THREE.Vector3(body.x-WIDTH/2,body.y,0),preview};group.scale.setScalar(radius);group.position.copy(visual.position);this.scene.add(group);
  this._decorate(visual);if(!preview)this.visuals.set(id,visual);return visual;
 }
 _decorate(v){
  const toLocal=(x,y)=>new THREE.Vector3((x-v.profile.sourceCenter.x)/v.profile.sourceRadius,(y-v.profile.sourceCenter.y)/v.profile.sourceRadius,0);
  if(v.flavor==='melon'){
   const points=[];for(let row=0;row<3;row++){const r=1.6+row*.72,count=3+row*3;for(let i=0;i<count;i++){const a=.84+(Math.PI-1.68)*(i+.5)/count,p=toLocal(Math.cos(a)*r,Math.sin(a)*r-2.1);if(!this._containsSlice(v.profile,p))continue;p.z=this._sliceFrontZ(v,p)+.011;points.push({p,rotation:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),a+Math.PI/2),scale:new THREE.Vector3(.067/v.profile.sourceRadius,.13/v.profile.sourceRadius,.018/v.profile.sourceRadius)});}}
   const mesh=new THREE.InstancedMesh(this.seedGeometry,this.darkSeedMaterial,points.length);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.castShadow=false;v.group.add(mesh);v.seeds={mesh,points,matrix:new THREE.Matrix4()};
  }
  const points=[];for(let i=0;i<24;i++){const sx=Math.sin(i*127.1+3)*2.65,sy=Math.sin(i*311.7+9)*2.3,p=toLocal(sx,sy);if(!this._containsSlice(v.profile,p)||v.flavor==='melon'&&Math.hypot(sx,sy+2.1)>3.6)continue;const size=(.025+(.5+.5*Math.sin(i*18.3))*.024)/v.profile.sourceRadius;p.z=this._sliceFrontZ(v,p)+.003;points.push({p,size});}
  const bubbles=new THREE.InstancedMesh(this.bubbleGeometry,this.bubbleMaterial,points.length);bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);v.group.add(bubbles);v.bubbles={mesh:bubbles,points,matrix:new THREE.Matrix4()};
 }
 _createPreview(){const visual=this._createVisual({id:'preview',level:0,radius:FRUITS[0].radius,x:5,y:13.2},true);visual.kick=0;return visual;}
 _syncVisuals(){
  if(!this.renderer||this.renderError)return;const m=this.model,wanted=new Set();let bodies=m.bodies||[];
  if(m.status==='ready')bodies=[{id:'demo-0',level:7,x:1.55,y:1.48,radius:FRUITS[7].radius,angle:.12},{id:'demo-1',level:4,x:4.1,y:.84,radius:FRUITS[4].radius,angle:-.2},{id:'demo-2',level:6,x:6.15,y:1.25,radius:FRUITS[6].radius,angle:-.25},{id:'demo-3',level:1,x:8.12,y:.43,radius:FRUITS[1].radius,angle:.25},{id:'demo-4',level:2,x:8.9,y:.54,radius:FRUITS[2].radius,angle:-.2},{id:'demo-5',level:3,x:3.6,y:2.2,radius:FRUITS[3].radius,angle:.44},{id:'demo-6',level:0,x:4.7,y:2.7,radius:FRUITS[0].radius,angle:.1}];
  if(m.status==='ready')bodies=bodies.map(body=>({...body,angle:body.angle+spawnAngle(body.level)}));
  for(const body of bodies){wanted.add(body.id);const v=this.visuals.get(body.id)||this._createVisual(body);v.target=body;v.angle=body.angle||0;}
  for(const [id,v] of this.visuals)if(!wanted.has(id)){this._disposeVisual(v);this.visuals.delete(id);}
  if(this.preview.level!==m.currentLevel){this._disposeVisual(this.preview);this.preview=this._createVisual({id:'preview',level:m.currentLevel||0,radius:FRUITS[m.currentLevel||0].radius,x:m.aimX||5,y:13.2},true);this.preview.kick=.15;}
  const level=m.currentLevel||0,angle=spawnAngle(level),spawnCenterY=spawnY(level,angle),shape=SLICE_PROFILES[FRUITS[level].sliceFlavor],radius=FRUITS[level].radius,minimumY=radius*Math.min(...shape.outline.map(point=>Math.sin(angle)*point.x+Math.cos(angle)*point.y));
  this.preview.group.visible=m.status!=='over';const aim=m.aimX??5;this.preview.target={x:aim,y:spawnCenterY+Math.sin(this.time*2)*.035,angle:angle+Math.sin(this.time*1.8)*.035,contacts:[]};
  let landing=-minimumY;if(typeof m.getLandingY==='function')landing=m.getLandingY(aim,level);else for(const b of m.bodies||[]){const dx=b.x-aim,sum=radius+b.radius;if(Math.abs(dx)<sum)landing=Math.max(landing,b.y+Math.sqrt(sum*sum-dx*dx));}landing=Math.min(landing,spawnCenterY);this.aimGuide.visible=m.status==='playing';this.landingRing.visible=m.status==='playing';if(this.aimGuide.visible){const p=this.aimGuide.geometry.attributes.position;p.setXYZ(0,aim-5,landing,-.5);p.setXYZ(1,aim-5,spawnCenterY+minimumY-.025,-.5);p.needsUpdate=true;this.aimGuide.computeLineDistances();this.landingRing.position.set(aim-5,landing,-2.42);this.landingRing.scale.setScalar(radius*.23);}
 }
 _deform(v,p){return this._deformXYZ(v,p.x,p.y,p.z,new THREE.Vector3());}
 _deformXYZ(v,x,y,z,out){
  const length=Math.sqrt(x*x+y*y+z*z)||1,nx=x/length,ny=y/length;let total=0,compression=0;for(const d of v.dents){if(Math.abs(d.value)<.0001)continue;const cosine=nx*Math.cos(d.angle)+ny*Math.sin(d.angle);const weight=Math.exp((cosine-1)*7);compression+=d.value*weight;total+=d.value;}
  const bulge=total*.085,w=v.wobble,radial=1+bulge+w*(nx*ny*.6+(ny*ny-.33)*.20);x*=radial;y*=radial;z*=1+total*.20-w*.10;z+=w*.07*(nx*nx-ny*ny)*Math.min(1,Math.hypot(x,y));const divisor=Math.max(.35,Math.sqrt(nx*nx+ny*ny));x-=nx/divisor*compression;y-=ny/divisor*compression;return out.set(x,y,z);
 }
 _deformVisual(v,dt){
  const target=v.target||{x:v.position.x+5,y:v.position.y,contacts:[]};v.group.rotation.z=v.angle;
  for(const d of v.dents)d.target=0;for(const contact of target.contacts||[]){const a=Math.atan2(-contact.ny,-contact.nx)-v.angle;for(const d of v.dents){const weight=Math.exp((Math.cos(d.angle-a)-1)*9),load=clamp(.035+(contact.depth||contact.penetration||0)/v.radius*.65+(contact.impulse||0)/(v.radius*v.radius*45),.025,.20);d.target=Math.max(d.target,load*weight);}}
  const steps=Math.max(1,Math.ceil(dt/.012)),step=dt/steps;if(dt>0){for(let n=0;n<steps;n++){for(const d of v.dents){d.velocity+=((d.target-d.value)*145-d.velocity*11)*step;d.value=clamp(d.value+d.velocity*step,-.065,.30);}v.wobbleV+=(-105*v.wobble-v.wobbleV*8.4)*step;v.wobble=clamp(v.wobble+v.wobbleV*step,-.16,.16);}}
  if(this.reducedMotion){v.wobble=0;for(const d of v.dents)d.value=d.target;}
  const deformation=[...v.dents.map(d=>d.value),v.wobble];const changed=!v.lastDeformation||deformation.some((value,index)=>Math.abs(value-v.lastDeformation[index])>.00022);
  if(changed){
   v.lastDeformation=deformation;const p=v.geometry.attributes.position.array;let displacement=0;
   for(let i=0;i<p.length;i+=3){const point=this._deformXYZ(v,v.original[i],v.original[i+1],v.original[i+2],this._deformPoint);p[i]=point.x;p[i+1]=point.y;p[i+2]=point.z;const dx=point.x-v.original[i],dy=point.y-v.original[i+1],dz=point.z-v.original[i+2];displacement=Math.max(displacement,dx*dx+dy*dy+dz*dz);}
   v.maxVertexDisplacement=Math.sqrt(displacement);this._maxIndent=Math.max(this._maxIndent,v.maxVertexDisplacement);v.geometry.attributes.position.needsUpdate=true;v.geometry.computeVertexNormals();
   if(v.seeds){const matrix=v.seeds.matrix;for(let i=0;i<v.seeds.points.length;i++){const seed=v.seeds.points[i],p=this._deform(v,seed.p);matrix.compose(p,seed.rotation,seed.scale);v.seeds.mesh.setMatrixAt(i,matrix);}v.seeds.mesh.instanceMatrix.needsUpdate=true;}
   if(v.bubbles){const matrix=v.bubbles.matrix;for(let i=0;i<v.bubbles.points.length;i++){const b=v.bubbles.points[i],p=this._deform(v,b.p);matrix.compose(p,new THREE.Quaternion(),new THREE.Vector3(b.size,b.size,b.size));v.bubbles.mesh.setMatrixAt(i,matrix);}v.bubbles.mesh.instanceMatrix.needsUpdate=true;}
  }
  if(v.formed){const age=this.time-v.bornAt,amount=age<.18?lerp(.28,.82,ease(age/.18)):1+Math.sin((age-.18)*20)*Math.exp(-(age-.18)*7)*.11;v.group.scale.setScalar(v.radius*amount);if(age>1)v.formed=false;}else v.group.scale.setScalar(v.radius);
  if(v.preview){v.position.x=lerp(v.position.x,target.x-5,1-Math.exp(-18*dt));v.position.y=target.y;v.kick=Math.max(0,(v.kick||0)-dt*.65);v.group.scale.set(v.radius*(1+v.kick*.25),v.radius*(1-v.kick*.4),v.radius);v.group.rotation.z=target.angle||0;v.group.position.copy(v.position);}else if(!v.fusing){v.position.set(target.x-5,target.y,0);v.group.position.copy(v.position);}
 }
 _burst(body,celebrate=false){
  if(!this.renderer||this.reducedMotion)return;const count=celebrate?42:8;for(let i=0;i<count&&this.particles.length<180;i++){const angle=i*2.3999,material=new THREE.MeshPhysicalMaterial({color:celebrate?['#f3ce56','#c1d760','#ef7289','#fff2c5'][i%4]:COLORS[body.level],roughness:.25,clearcoat:1,transparent:true,opacity:.85,depthWrite:false}),mesh=new THREE.Mesh(this.bubbleGeometry,material);mesh.position.set(body.x-5,body.y,.6);this.scene.add(mesh);this.particles.push({mesh,velocity:new THREE.Vector3(Math.cos(angle)*(1.3+i%4),Math.sin(angle)*(1.8+i%3)+2.4,1+i%2),life:celebrate?1.7:.55,age:0,size:celebrate?.045+i%3*.025:.035+i%3*.022});}
 }
 _disposeVisual(v){this.scene?.remove(v.group);v.geometry.dispose();for(const child of v.group.children){if(child.geometry!==v.geometry&&child.geometry!==this.seedGeometry&&child.geometry!==this.bubbleGeometry)child.geometry?.dispose();if(child.isInstancedMesh)child.dispose();}}
 _clearVisuals(){for(const v of this.visuals.values())this._disposeVisual(v);this.visuals.clear();for(const f of this.fusions)this._disposeVisual(f.visual);this.fusions.length=0;for(const p of this.particles){this.scene?.remove(p.mesh);p.mesh.material.dispose();}this.particles.length=0;this._maxIndent=0;}
 _renderFrame(dt){
  if(!this.renderer||this.renderError||!this._visible)return;this.time+=dt;for(const v of this.visuals.values())this._deformVisual(v,dt);if(this.preview)this._deformVisual(this.preview,dt);
  for(let i=this.fusions.length-1;i>=0;i--){const f=this.fusions[i];f.age+=dt;const t=clamp(f.age/f.life,0,1);if(t>=1){this._disposeVisual(f.visual);this.fusions.splice(i,1);continue;}f.visual.fusing=true;f.visual.target={contacts:[]};this._deformVisual(f.visual,dt);f.visual.group.position.lerpVectors(f.from,f.to,ease(t));f.visual.group.scale.setScalar(f.visual.radius*(1-.76*ease(t)));f.visual.group.rotation.z+=Math.sin(t*Math.PI)*.15;}
  for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.age+=dt;if(p.age>=p.life){this.scene.remove(p.mesh);p.mesh.material.dispose();this.particles.splice(i,1);continue;}p.velocity.y-=8*dt;p.mesh.position.addScaledVector(p.velocity,dt);p.mesh.rotation.z+=dt*2;p.mesh.scale.setScalar(p.size*(1-p.age/p.life));p.mesh.material.opacity=.8*(1-p.age/p.life);}
  const danger=this.root.classList.contains('fm-in-danger');this.dangerLine.material.color.set(danger?'#d77355':'#9da18b');this.dangerLine.material.opacity=danger?.65+Math.sin(this.time*7)*.24:.40;if(this._toastUntil&&this.time>this._toastUntil){this.root.querySelector('#fm-merge-toast').classList.remove('show');this._toastUntil=0;}
  this.renderer.render(this.scene,this.camera);this.frames++;
 }
}
export default FruitMergeGame;
