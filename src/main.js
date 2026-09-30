import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { area,centroid,splitPolygon,contains,resample,bladeCrossing } from './geometry.js';
import { SoftBody } from './softbody.js';
import { GameUI } from './game-ui.js';
import { CHAPTERS,ORDERS,ACHIEVEMENTS,getOrder,evaluateOrder,generateOrder,loadProfile,saveProfile,completeOrder,recordGeneratedResult,nextOrderId,rindFraction } from './progression.js';
import { createPlating,sourcePositions } from './plating.js';

const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
const v3=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const TAU=Math.PI*2;
const FRUITS={
  melon:{name:'西瓜软糖',english:'WATERMELON JELLY',number:'01',height:1.22,color:'#dc244a',radius:4.25},
  citrus:{name:'阳光蜜橙',english:'SUNSHINE CITRUS',number:'02',height:1.3,color:'#f9ad20',radius:3.05},
  grape:{name:'葡萄云朵',english:'GRAPE DAYDREAM',number:'03',height:1.42,color:'#a58bd4',radius:3.0}
};
let scene,camera,renderer,ground,knife,guide,shadowMaterial;
let bodies=[],droplets=[],flavor='melon',tool='drag',cuts=0,softness=.62,damping=.45;
let time=0,lastTime=0,accumulator=0,bodyId=0,drag=null,cutAction=null,stroke=null;
let paused=false,slowMode=false,showMesh=false,lastReadout=0,lastLandSound=0;
const activeTouches=new Map();
let soundEnabled=true,audioContext=null,master=null,noise=null,toastTimeout=null;
let pointer={x:0,y:0,seen:false,down:false,world:v3(),ndc:new THREE.Vector2(),id:null};
let knifeAngle=0,spaceHeld=false,previousTool='drag',reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let viewport={width:innerWidth,height:innerHeight,mobile:innerWidth<=650};
let metrics={fps:60,frames:0,lastSample:0,physicsMs:0};
let ui,plating,profile,mode='menu',order=null,orderElapsed=0,initialMasses={},selected=null,history=[],lastHUD=0,practiceSeed='',hintCount=0,undoCount=0;
let pieceBadge,cutEstimate,previewAt=0,previewShares='';
const raycaster=new THREE.Raycaster(),plane=new THREE.Plane(v3(0,1,0),0),temp=v3();

function init(){
  scene=new THREE.Scene();scene.background=new THREE.Color('#edeae2');
  camera=new THREE.OrthographicCamera(-10,10,7,-7,.1,120);
  camera.position.set(9.2,13.6,17.7);camera.lookAt(0,0,0);
  try{renderer=new THREE.WebGLRenderer({canvas:$('world'),antialias:true,powerPreference:'high-performance',alpha:false})}
  catch(error){$('error-panel').hidden=false;$('loading').classList.add('done');console.error(error);return}
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.90;
  const room=new RoomEnvironment();
  const softbox=new THREE.Mesh(new THREE.BoxGeometry(3.2,.08,2.0),new THREE.MeshBasicMaterial({color:new THREE.Color(2.5,2.5,2.5)}));softbox.position.set(-3.5,6,-6.5);room.add(softbox);
  const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(room,.055).texture;room.dispose();pmrem.dispose();
  scene.environmentIntensity=.70;
  scene.add(new THREE.HemisphereLight('#fff8e6','#b3b6a2',.85));
  const sun=new THREE.DirectionalLight('#fff7e9',2.5);sun.position.set(-5,12,6);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-13;sun.shadow.camera.right=13;sun.shadow.camera.top=13;sun.shadow.camera.bottom=-13;sun.shadow.camera.near=.1;sun.shadow.camera.far=40;sun.shadow.normalBias=.028;sun.shadow.bias=-.0002;sun.shadow.radius=4;scene.add(sun);
  const fill=new THREE.DirectionalLight('#ffffff',.6);fill.position.set(6,5,-5);scene.add(fill);
  ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#e2ded2',roughness:1,metalness:0}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
  // A contact gradient underneath each piece keeps small deformations visually grounded.
  const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d'),g=ctx.createRadialGradient(64,64,2,64,64,64);g.addColorStop(0,'rgba(54,39,31,.25)');g.addColorStop(.45,'rgba(65,47,36,.13)');g.addColorStop(1,'rgba(65,47,36,0)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);const tex=new THREE.CanvasTexture(c);
  shadowMaterial=new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,opacity:.52});
  makeKnife();plating=createPlating(scene);resize();resetScene(false);bindUI();initGame();
  $('loading').classList.add('done');
  requestAnimationFrame(frame);
}

function recipePolygon(type){
  if(type==='melon'){
    const p=[{x:0,z:-2.1}];
    for(let i=0;i<=40;i++){const a=.74+(Math.PI-1.48)*i/40;p.push({x:Math.cos(a)*4.25,z:Math.sin(a)*4.25-2.1})}
    return p;
  }
  if(type==='citrus')return Array.from({length:56},(_,i)=>{const a=i/56*TAU;return{x:Math.cos(a)*3.05,z:Math.sin(a)*2.66}});
  // A rounded square is a convex shape, so every subsequent plane cut stays valid.
  const p=[];for(let j=0;j<4;j++){const a0=-Math.PI/2+j*Math.PI/2,cx=j===0||j===1?1.5:-1.5,cz=j<2?(j===0?-1.5:1.5):(j===2?1.5:-1.5);for(let i=0;i<=10;i++){const a=a0+i/10*Math.PI/2;p.push({x:cx+Math.cos(a)*1.04,z:cz+Math.sin(a)*1.04})}}return p;
}

const colorScratch=new THREE.Color();
function edgeDistance(poly,p){let min=Infinity;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],dx=b.x-a.x,dz=b.z-a.z,t=clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz),0,1);min=Math.min(min,Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t))}return min}
function surfaceColor(type,x,z,y,h){
  if(type==='melon'){
    const r=Math.hypot(x,z+2.1),ang=Math.atan2(z+2.1,x),top=smooth(h*.7,h*.95,y);
    const stripe=Math.sin(ang*33+Math.sin(y*5+ang*7)*.62)+Math.sin(ang*65+y*1.8)*.19;
    if(r>4.00){colorScratch.set(stripe>.12?'#3d7736':'#164c2c');colorScratch.lerp(new THREE.Color('#85a953'),top*.12)}
    else if(r>3.76){colorScratch.set('#f3efbc');if(r<3.82)colorScratch.lerp(new THREE.Color('#f79c91'),.3)}
    else{colorScratch.set('#c71940');const grain=Math.sin(x*58+z*91)*Math.sin(z*51-x*25);colorScratch.offsetHSL(grain*.002,0,grain*.009+Math.cos(r*2)*.015)}
  }else if(type==='citrus'){
    const r=Math.hypot(x/3.05,z/2.66),a=Math.atan2(z/2.66,x/3.05),segment=Math.abs(Math.sin(a*5));
    colorScratch.set(r>.94?'#e99915':r>.88?'#ffe6a0':r<.095?'#ffd87e':segment<.042&&y>h*.9?'#ffcf6e':'#f18c08');
    colorScratch.offsetHSL(0,0,Math.sin(x*82+z*63)*Math.cos(z*43)*.017);
  }else{
    colorScratch.set('#8856b8');colorScratch.offsetHSL(Math.sin(x+z)*.015,Math.sin(x*3-z*2)*.03,Math.cos(x*1.6)*Math.cos(z*1.2)*.045);
  }
  return colorScratch;
}

class Jelly{
  constructor(poly,type,opts={}){
    this.id=++bodyId;this.poly=poly;this.type=type;this.center=centroid(poly);this.area=area(poly);this.recipeScale=opts.recipeScale??1;this.h=FRUITS[type].height*this.recipeScale;this.slot=null;this.tossed=opts.tossed??false;
    this.pos=v3();this.vel=v3();this.q=0;this.angle=0;this.lastFloor=false;
    this.radius=Math.max(...poly.map(p=>Math.hypot(p.x-this.center.x,p.z-this.center.z)));
    this.physics=new SoftBody(poly,this.h,{targetParticles:Math.max(45,Math.round(420*this.area/17.8)),offset:{x:0,y:opts.drop??.04,z:0},initializer:opts.initializer,iterations:4,stiffnessAt:p=>type==='melon'&&Math.hypot(p.x/this.recipeScale,p.z/this.recipeScale+2.1)>3.84?3:type==='citrus'&&Math.hypot(p.x/(3.05*this.recipeScale),p.z/(2.66*this.recipeScale))>.88?2.5:1});
    this.group=new THREE.Group();scene.add(this.group);
    this.makeMesh();this.makeDetails();
    this.bindings=this.bindGeometry(this.geometry,this.center.x,0,this.center.z);
    for(const d of this.details){d.mesh.position.set(d.x+this.center.x,d.y,d.z+this.center.z);d.mesh.updateMatrix();d.mesh.geometry.applyMatrix4(d.mesh.matrix);d.mesh.position.set(0,0,0);d.mesh.rotation.set(0,0,0);d.mesh.scale.set(1,1,1);d.bindings=this.bindGeometry(d.mesh.geometry)}
    this.surfaceIds=[...new Set(this.physics.surfaceTriangles)];this.contactRadius=this.physics.spacing*.28;
    const wireGeometry=new THREE.BufferGeometry();wireGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(this.physics.positions.length),3));wireGeometry.setIndex(new THREE.BufferAttribute(new Uint32Array(this.physics.surfaceTriangles),1));
    this.wire=new THREE.Mesh(wireGeometry,new THREE.MeshBasicMaterial({color:'#374c3d',wireframe:true,transparent:true,opacity:.34,depthTest:false}));this.wire.visible=showMesh;this.wire.renderOrder=5;this.group.add(this.wire);
    this.shadow=new THREE.Mesh(new THREE.PlaneGeometry(1,1),shadowMaterial.clone());this.shadow.rotation.x=-Math.PI/2;this.shadow.position.y=.012;scene.add(this.shadow);
    this.render();
  }
  bindGeometry(geometry,dx=0,dy=0,dz=0){const a=geometry.attributes.position;return Array.from({length:a.count},(_,i)=>this.physics.bindPoint(a.getX(i)+dx,a.getY(i)+dy,a.getZ(i)+dz))}
  makeMesh(){
    const outline=resample(this.poly,.20),n=outline.length,h=this.h;
    // Concentric tessellation and rounded rim: top, side and fresh cross-section share one surface.
    const rings=[{s:.012,y:.04},{s:.35,y:.025},{s:.68,y:.025},{s:.92,y:.03},{s:.982,y:.095},{s:1,y:.20},{s:1.009,y:h*.42},{s:1.009,y:h*.64},{s:1,y:h-.19},{s:.982,y:h-.065},{s:.94,y:h+.014},{s:.83,y:h+.06},{s:.66,y:h+.082},{s:.48,y:h+.091},{s:.29,y:h+.096},{s:.012,y:h+.10}];
    const points=[],colors=[],indices=[];
    for(const ring of rings)for(const p of outline){const x=this.center.x+(p.x-this.center.x)*ring.s,z=this.center.z+(p.z-this.center.z)*ring.s;points.push(x-this.center.x,ring.y,z-this.center.z);const color=surfaceColor(this.type,x/this.recipeScale,z/this.recipeScale,ring.y/this.recipeScale,h/this.recipeScale);colors.push(color.r,color.g,color.b)}
    for(let r=0;r<rings.length-1;r++)for(let j=0;j<n;j++){const a=r*n+j,b=r*n+(j+1)%n,c=(r+1)*n+j,d=(r+1)*n+(j+1)%n;indices.push(a,c,b,b,c,d)}
    // Winding above is outward for a polygon ordered counterclockwise in XZ.
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    this.rest=new Float32Array(points);this.geometry=geometry;
    this.material=new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.17,metalness:0,clearcoat:1,clearcoatRoughness:.07,transmission:.17,thickness:1.3,ior:1.46,envMapIntensity:1.15,side:THREE.DoubleSide,attenuationColor:new THREE.Color(FRUITS[this.type].color),attenuationDistance:3});
    this.mesh=new THREE.Mesh(geometry,this.material);this.mesh.castShadow=true;this.mesh.receiveShadow=true;this.mesh.userData.body=this;this.group.add(this.mesh);
  }
  makeDetails(){
    this.details=[];
    if(this.type==='melon'){
      const seeds=[];
      for(let row=0;row<3;row++){const radius=1.6+row*.72,count=3+row*3;for(let i=0;i<count;i++){const a=.84+(Math.PI-1.68)*(i+.5)/count;seeds.push({x:Math.cos(a)*radius,z:Math.sin(a)*radius-2.1,a})}}
      for(const seed of seeds){const p={x:seed.x*this.recipeScale,z:seed.z*this.recipeScale,a:seed.a};if(contains(this.poly,p)&&edgeDistance(this.poly,p)>.18*this.recipeScale){
        const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,10,8),new THREE.MeshPhysicalMaterial({color:'#492d29',roughness:.2,clearcoat:1}));mesh.scale.set(.067,.018,.13);mesh.rotation.y=-p.a+Math.PI/2;this.group.add(mesh);this.details.push({mesh,x:p.x-this.center.x,z:p.z-this.center.z,y:this.h+.094});
      }}
    }
    // Tiny trapped bubbles add depth without requiring textures or external image assets.
    for(let i=0;i<24;i++){
      const x=Math.sin(i*127.1+3)*2.65*this.recipeScale,z=Math.sin(i*311.7+9)*2.3*this.recipeScale;
      if(!contains(this.poly,{x,z})||this.type==='melon'&&Math.hypot(x/this.recipeScale,z/this.recipeScale+2.1)>3.6)continue;
      const r=.025+(.5+.5*Math.sin(i*18.3))*.024;
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(r,6,5),new THREE.MeshBasicMaterial({color:this.type==='grape'?'#f0d8fa':'#ffe4b6',transparent:true,opacity:.32}));mesh.scale.y=.38;this.group.add(mesh);this.details.push({mesh,x:x-this.center.x,z:z-this.center.z,y:this.h+.083});
    }
  }
  sync(){
    const a=this.physics.positions,v=this.physics.velocities,n=a.length/3;this.pos.set(0,0,0);this.vel.set(0,0,0);this.min=v3(Infinity,Infinity,Infinity);this.max=v3(-Infinity,-Infinity,-Infinity);
    for(let i=0;i<a.length;i+=3){this.pos.x+=a[i];this.pos.y+=a[i+1];this.pos.z+=a[i+2];this.vel.x+=v[i];this.vel.y+=v[i+1];this.vel.z+=v[i+2];this.min.x=Math.min(this.min.x,a[i]);this.min.y=Math.min(this.min.y,a[i+1]);this.min.z=Math.min(this.min.z,a[i+2]);this.max.x=Math.max(this.max.x,a[i]);this.max.y=Math.max(this.max.y,a[i+1]);this.max.z=Math.max(this.max.z,a[i+2])}
    this.pos.multiplyScalar(1/n);this.vel.multiplyScalar(1/n);
  }
  pose(){const pose=this.physics.getPose(),q=pose.quaternion;return{center:v3(pose.center.x,pose.center.y,pose.center.z),restCenter:v3(pose.restCenter.x,pose.restCenter.y,pose.restCenter.z),rotation:new THREE.Quaternion(q.x,q.y,q.z,q.w)}}
  worldToLocal(p){const pose=this.pose();return v3(p.x,p.y??this.pos.y,p.z).sub(pose.center).applyQuaternion(pose.rotation.invert()).add(pose.restCenter)}
  sampleRest(p){return this.physics.sample(this.physics.bindPoint(p.x,p.y??this.h*.5,p.z))}
  translate(delta){const a=this.physics.positions;for(let i=0;i<a.length;i+=3){a[i]+=delta.x;a[i+1]+=delta.y;a[i+2]+=delta.z}}
  impulse(velocity,angular=v3()){
    this.sync();const p=this.physics.positions,v=this.physics.velocities;
    for(let i=0;i<p.length;i+=3){const x=p[i]-this.pos.x,y=p[i+1]-this.pos.y,z=p[i+2]-this.pos.z;v[i]+=velocity.x+angular.y*z-angular.z*y;v[i+1]+=velocity.y+angular.z*x-angular.x*z;v[i+2]+=velocity.z+angular.x*y-angular.y*x}
  }
  updateSurface(geometry,bindings){const a=geometry.attributes.position.array;for(let i=0;i<bindings.length;i++){this.physics.sample(bindings[i],temp);a[i*3]=temp.x;a[i*3+1]=temp.y;a[i*3+2]=temp.z}geometry.attributes.position.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere()}
  render(){
    this.renderMeshState=showMesh;
    this.sync();this.updateSurface(this.geometry,this.bindings);
    for(const d of this.details)this.updateSurface(d.mesh.geometry,d.bindings);
    if(showMesh){this.wire.geometry.attributes.position.array.set(this.physics.positions);this.wire.geometry.attributes.position.needsUpdate=true;this.wire.geometry.computeBoundingSphere()}this.wire.visible=showMesh;
    const servingScale=this.slot===null?1:.43;this.group.scale.setScalar(servingScale);this.group.position.set(this.pos.x*(1-servingScale),.027*(1-servingScale),this.pos.z*(1-servingScale));
    const lift=Math.max(0,this.min.y),factor=1+lift*.20;this.shadow.position.set(this.pos.x,.014,this.pos.z);this.shadow.scale.set((this.max.x-this.min.x+.5)*1.2*factor*servingScale,(this.max.z-this.min.z+.5)*1.2*factor*servingScale,1);this.shadow.material.opacity=.44/(1+lift*1.8);
  }
  destroy(){scene.remove(this.group,this.shadow);this.geometry.dispose();this.material.dispose();this.wire.geometry.dispose();this.wire.material.dispose();this.shadow.geometry.dispose();this.shadow.material.dispose();for(const d of this.details){d.mesh.geometry.dispose();d.mesh.material.dispose()}}
}

function makeKnife(){
  knife=new THREE.Group();
  const steel=new THREE.MeshPhysicalMaterial({color:'#bfc8c9',metalness:.94,roughness:.23,clearcoat:1,envMapIntensity:1.3});
  const bladeGeometry=new RoundedBoxGeometry(7.8,1.48,.10,3,.065),bladeColors=[];
  for(let i=0;i<bladeGeometry.attributes.position.count;i++){const y=bladeGeometry.attributes.position.getY(i),t=(y+.74)/1.48,shade=lerp(.14,.85,smooth(.08,.95,t));bladeColors.push(shade,shade*1.025,shade*1.035)}
  bladeGeometry.setAttribute('color',new THREE.Float32BufferAttribute(bladeColors,3));
  const bladeMaterial=steel.clone();bladeMaterial.vertexColors=true;
  const blade=new THREE.Mesh(bladeGeometry,bladeMaterial);blade.position.set(.3,.83,0);blade.castShadow=true;knife.add(blade);
  const edge=new THREE.Mesh(new THREE.BoxGeometry(7.65,.10,.12),new THREE.MeshStandardMaterial({color:'#f1f4ef',metalness:.95,roughness:.18}));edge.position.set(.28,.10,0);knife.add(edge);
  const handle=new THREE.Mesh(new RoundedBoxGeometry(2.08,.44,.30,4,.09),new THREE.MeshPhysicalMaterial({color:'#251f1a',roughness:.35,clearcoat:.55}));handle.position.set(-4.45,1.15,0);handle.castShadow=true;knife.add(handle);
  const bolster=new THREE.Mesh(new THREE.BoxGeometry(.14,.5,.32),steel);bolster.position.set(-3.48,1.15,0);knife.add(bolster);
  for(let i=0;i<3;i++){const rivet=new THREE.Mesh(new THREE.SphereGeometry(.047,10,6),steel);rivet.scale.z=.2;rivet.position.set(-5.05+i*.55,1.15,.156);knife.add(rivet)}
  knife.visible=false;scene.add(knife);
  const lineGeo=new THREE.BufferGeometry().setFromPoints([v3(-4,0,0),v3(4,0,0)]);
  guide=new THREE.Line(lineGeo,new THREE.LineDashedMaterial({color:'#617352',dashSize:.11,gapSize:.10,transparent:true,opacity:.48,depthTest:false}));guide.computeLineDistances();guide.visible=false;guide.renderOrder=4;scene.add(guide);
}

function initAudio(){
  if(!soundEnabled)return;
  try{
    if(!audioContext){audioContext=new(window.AudioContext||window.webkitAudioContext)();master=audioContext.createGain();master.gain.value=.52;master.connect(audioContext.destination);noise=audioContext.createBuffer(1,audioContext.sampleRate*.5,audioContext.sampleRate);const a=noise.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=Math.random()*2-1}
    if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});
  }catch{soundEnabled=false}
}
function tone(freq,end,duration,volume,type='sine',delay=0){
  if(!audioContext||!soundEnabled)return;
  const t=audioContext.currentTime+delay,osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,t);osc.frequency.exponentialRampToValueAtTime(Math.max(20,end),t+duration);gain.gain.setValueAtTime(.001,t);gain.gain.linearRampToValueAtTime(volume,t+.012);gain.gain.exponentialRampToValueAtTime(.001,t+duration);osc.connect(gain);gain.connect(master);osc.start(t);osc.stop(t+duration+.01);osc.onended=()=>{osc.disconnect();gain.disconnect()};
}
function playSound(kind,strength=1){
  if(!audioContext||!soundEnabled)return;
  if(kind==='cut'){
    tone(190,55,.21,.24*strength);tone(440,130,.13,.095*strength,'sine',.025);
    const t=audioContext.currentTime,source=audioContext.createBufferSource(),filter=audioContext.createBiquadFilter(),gain=audioContext.createGain();source.buffer=noise;filter.type='lowpass';filter.frequency.setValueAtTime(2400,t);filter.frequency.exponentialRampToValueAtTime(170,t+.22);gain.gain.setValueAtTime(.16*strength,t);gain.gain.exponentialRampToValueAtTime(.001,t+.24);source.connect(filter);filter.connect(gain);gain.connect(master);source.start();source.stop(t+.26);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect()};
  }else if(kind==='grab')tone(200,350,.10,.085);
  else if(kind==='release'){tone(280,105,.27,.11*strength);tone(360,140,.18,.035*strength,'sine',.05)}
  else if(kind==='land')tone(115+Math.random()*40,48,.16,.10*strength);
  else if(kind==='jiggle'){tone(150,380,.15,.11);tone(330,80,.32,.12,'sine',.10)}
  else tone(520,650,.075,.04);
}

function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('show'),2300)}
function updateCounts(){$('cuts').textContent=String(cuts).padStart(2,'0');$('pieces').textContent=String(bodies.length).padStart(2,'0')}
function clearBoard(){cancelInteraction();for(const b of bodies)b.destroy();bodies=[];for(const d of droplets){scene.remove(d.mesh);d.mesh.geometry.dispose();d.mesh.material.dispose()}droplets=[];cuts=0;selected=null;history=[];previewShares=''}
function resetScene(announce=true){
  if(order&&mode==='order'){startOrder(order);return}
  clearBoard();
  const body=new Jelly(recipePolygon(flavor),flavor,{drop:reducedMotion?.04:.9});bodies.push(body);updateCounts();
  $('flavor-name').textContent=FRUITS[flavor].name;$('flavor-english').textContent=FRUITS[flavor].english;$('specimen-number').textContent=FRUITS[flavor].number;
  if(announce){initAudio();playSound('release');toast('新鲜的一块。再来。')}
}
function jiggle(){initAudio();playSound('jiggle');for(const b of bodies)if(b.slot===null){b.tossed=true;b.impulse(v3((Math.random()-.5)*.6,2.6+Math.random()*.8,(Math.random()-.5)*.6),v3((Math.random()-.5)*1.2,(Math.random()-.5)*.6,(Math.random()-.5)*1.2))}toast('软乎乎，晃悠悠。')}

function initGame(){
  profile=loadProfile();
  ui=new GameUI({onStart:id=>startOrder(getOrder(id)),onResume:()=>{lastTime=0;accumulator=0},onSandbox:()=>{order=null;mode='sandbox';ui.showSandbox();plating.setVisible(false);resetScene(false);setTool('drag')},onPractice:seed=>{practiceSeed=String(seed||Date.now());startOrder(generateOrder(practiceSeed))},onSubmit:submitOrder,onRetry:()=>startOrder(order),onNext:()=>{if(order?.mode==='practice'){practiceSeed=practiceSeed+'+1';startOrder(generateOrder(practiceSeed,{difficulty:Math.min(8,(profile.practice?.completed||0)+1)}))}else{const id=ORDERS.every(o=>profile.completed[o.id]?.stars)?null:nextOrderId(profile);if(id)startOrder(getOrder(id));else openMenu()}},onMenu:openMenu,onUndo:undoAction,onHint:()=>{hintCount++;ui.showHint(order?.hint||'先把果冻切成所需分量，再把小块拖到对应的餐盘。点击小块后点击餐盘，也可以交付。')},onSlot:serveSelected,onReturnSlot:returnSlot,onKeepWorking:()=>{mode='order';ui.showHUD({level:order,index:ORDERS.findIndex(o=>o.id===order.id),total:ORDERS.length,profile});refreshHUD()}});
  pieceBadge=document.createElement('div');pieceBadge.className='piece-badge';pieceBadge.hidden=true;pieceBadge.setAttribute('aria-hidden','true');$('app').append(pieceBadge);
  cutEstimate=document.createElement('div');cutEstimate.id='cut-estimate';cutEstimate.hidden=true;cutEstimate.setAttribute('aria-hidden','true');$('app').append(cutEstimate);
  openMenu();
}
function openMenu(){
  cancelInteraction();mode='menu';pieceBadge&&(pieceBadge.hidden=true);cutEstimate&&(cutEstimate.hidden=true);plating.setVisible(false);ui.showMenu({profile,levels:ORDERS,chapters:CHAPTERS,achievements:ACHIEVEMENTS});
}
function startOrder(level){
  if(!level){openMenu();return}
  order=level;mode='order';clearBoard();orderElapsed=0;hintCount=0;undoCount=0;paused=false;accumulator=0;softness=.62;damping=.60;$('softness').value=62;$('damping').value=60;$('pause-mode').textContent='暂停';$('pause-mode').setAttribute('aria-pressed','false');
  const sources=level.source?.length?level.source:[{flavor:level.flavor||'melon'}],positions=sourcePositions(sources.length,{mobile:viewport.mobile});initialMasses={};
  for(let i=0;i<sources.length;i++){
    const source=sources[i],type=source.flavor||level.flavor||'melon',scale=source.scale??(sources.length>1?.68:.87);
    const poly=recipePolygon(type).map(p=>({x:p.x*scale,z:p.z*scale}));
    const b=new Jelly(poly,type,{recipeScale:scale,drop:.045});const p=positions[i]||{x:0,z:-1.1};b.translate(v3(p.x,0,p.z));b.sync();bodies.push(b);initialMasses[type]=(initialMasses[type]||0)+b.area*b.h;
  }
  flavor=sources[0].flavor||level.flavor||'melon';plating.setSlots(level.slots,{mobile:viewport.mobile});plating.setVisible(true);setTool('drag');updateCounts();
  if(ORDERS.some(o=>o.id===level.id)){profile.selectedOrderId=level.id;profile.resume={...profile.resume,mode:'campaign',orderId:level.id};saveProfile(profile)}
  ui.showHUD({level,index:ORDERS.findIndex(o=>o.id===level.id),total:ORDERS.length,profile});refreshHUD();initAudio();playSound('tap');
}
function shareOf(b){return b.area*b.h/(initialMasses[b.type]||b.area*b.h)*100}
function rindOf(b){return b.rind??(b.rind=rindFraction(b.poly,b.type,b.recipeScale))}
function refreshHUD(){
  if(!order||mode!=='order')return;
  ui.updateHUD({elapsed:orderElapsed,cuts,cutBudget:order.cutBudget,canUndo:history.length>0&&!cutAction,undoCount,slots:order.slots.map((s,index)=>{const b=bodies.find(b=>b.slot===index),actual=b?shareOf(b):null;return{...s,filled:!!b,label:s.label,target:s.share,actual,accuracy:actual===null?null:Math.max(0,100-Math.abs(actual-s.share)/s.share*100),flavor:s.flavor}}),selectedPiece:selected&&bodies.includes(selected)?{id:selected.id,share:shareOf(selected),flavor:FRUITS[selected.type].name,flavorKey:selected.type,rindFraction:rindOf(selected),slot:selected.slot}:null});
}
function captureBoard(){
  return{cuts,selectedId:selected?.id,bodies:bodies.map(b=>({id:b.id,poly:b.poly.map(p=>({...p})),type:b.type,recipeScale:b.recipeScale,positions:Array.from(b.physics.positions),velocities:Array.from(b.physics.velocities),slot:b.slot,boardCenter:b.boardCenter?.clone(),tossed:b.tossed}))};
}
function pushHistory(){if(mode!=='order')return;history.push(captureBoard());if(history.length>12)history.shift()}
function undoAction(){
  if(mode!=='order'||!history.length||cutAction){toast(cutAction?'等这一刀落下，再撤销。':'还没有可撤销的操作。');return}
  cancelInteraction();const snap=history.pop();for(const b of bodies)b.destroy();bodies=[];
  for(const data of snap.bodies){const b=new Jelly(data.poly,data.type,{recipeScale:data.recipeScale,drop:.04});if(b.physics.positions.length===data.positions.length){b.physics.positions.set(data.positions);b.physics.previous.set(data.positions);b.physics.velocities.set(data.velocities)}b.id=data.id;b.slot=data.slot;b.boardCenter=data.boardCenter;b.tossed=data.tossed;b.render();bodies.push(b)}
  cuts=snap.cuts;selected=bodies.find(b=>b.id===snap.selectedId)||null;undoCount++;order.slots.forEach((s,i)=>plating.setFilled(i,bodies.some(b=>b.slot===i),FRUITS[s.flavor||flavor].color));updateCounts();refreshHUD();toast('回到上一步。再试一刀。');
}
function serveSelected(index){
  if(mode!=='order'||cutAction)return;
  if(!selected||!bodies.includes(selected)||selected.slot!==null){toast('先点击要交付的小块，再点餐盘；也可以直接拖进去。');return}
  if(bodies.some(b=>b.slot===index)){toast('这个餐盘已经有了。点击餐盘可以退回。');return}
  pushHistory();const b=selected;b.sync();b.boardCenter=b.pos.clone();const p=plating.target(index);b.translate(v3(p.x-b.pos.x,.027-b.min.y,p.z-b.pos.z));b.physics.velocities.fill(0);b.slot=index;b.render();plating.setFilled(index,true,FRUITS[b.type].color);selected=null;refreshHUD();playSound('tap');toast(`已交付 ${FRUITS[b.type].name} ${shareOf(b).toFixed(1)}%。点击餐盘可取回。`);
}
function returnSlot(index){
  const b=bodies.find(b=>b.slot===index);if(!b||mode!=='order'||cutAction)return;
  pushHistory();b.slot=null;b.group.scale.setScalar(1);b.group.position.set(0,0,0);b.sync();const p=b.boardCenter||v3(0,.7,-1.1);b.translate(v3(p.x-b.pos.x,0,p.z-b.pos.z));b.physics.velocities.fill(0);b.render();selected=b;plating.setFilled(index,false);refreshHUD();toast('已取回，可以继续切配。');
}
function submitOrder(){
  if(mode!=='order'||cutAction||drag){toast('等果冻停稳，再交单。');return}
  const snapshot={pieces:bodies.map(b=>({id:b.id,flavor:b.type,mass:b.area*b.h,slot:b.slot,settled:b.slot!==null||b.vel.length()<.45&&b.min.y<.12,height:b.slot!==null?0:b.min.y,speed:b.slot!==null?0:b.vel.length(),rindFraction:rindOf(b),tossed:b.tossed,position:b.slot!==null?(order.slots[b.slot].position||plating.worldToNormalized(b.pos)):undefined})),cuts,elapsed:orderElapsed,totalMass:Object.values(initialMasses).reduce((a,b)=>a+b,0),flavorMasses:{...initialMasses},undos:undoCount,hints:hintCount};
  const result=evaluateOrder(order,snapshot);cancelInteraction();mode='result';
  const priorAchievements=new Set(profile.achievements);if(result.passed){profile=ORDERS.some(o=>o.id===order.id)?completeOrder(profile,order.id,result):recordGeneratedResult(profile,order,result);saveProfile(profile)}
  result.newAchievements=profile.achievements.filter(id=>!priorAchievements.has(id)).map(id=>ACHIEVEMENTS.find(a=>a.id===id));
  const nextId=ORDERS.some(o=>o.id===order.id)?(ORDERS.every(o=>profile.completed[o.id]?.stars)?null:nextOrderId(profile)):'practice';ui.showResult(result,{level:order,nextId,profile});if(result.passed){tone(523,523,.12,.1);tone(659,659,.13,.1,'sine',.12);tone(784,784,.23,.1,'sine',.25)}
}
function dropAt(x,y){
  const card=ui?.getDropTargets().find(t=>x>=t.rect.left&&x<=t.rect.right&&y>=t.rect.top&&y<=t.rect.bottom);if(card)return card.index;
  if(!order)return -1;let nearest=-1,distance=viewport.mobile?29:49;
  order.slots.forEach((s,index)=>{const target=plating.target(index),p=window.__jelly.project(target.x,.10,target.z),d=Math.hypot(x-p.x,y-p.y);if(d<distance){distance=d;nearest=index}});return nearest;
}
function updateBadges(now){
  const active=mode==='order'&&ui.state==='order';pieceBadge.hidden=!active||!selected||!bodies.includes(selected);cutEstimate.hidden=!active||tool!=='cut'||cutAction||!pointer.seen;
  if(!pieceBadge.hidden){const p=window.__jelly.project(selected.pos.x,selected.max.y+.16,selected.pos.z);pieceBadge.style.left=clamp(p.x,70,viewport.width-70)+'px';pieceBadge.style.top=clamp(p.y,120,viewport.height-180)+'px';pieceBadge.textContent=FRUITS[selected.type].name+' · '+shareOf(selected).toFixed(1)+'%';}
  if(!cutEstimate.hidden){const point=stroke?(stroke.moved?stroke.start.clone().add(stroke.end).multiplyScalar(.5):stroke.start):bladePlacement();if(now-previewAt>110){const normal={x:-Math.sin(knifeAngle),z:Math.cos(knifeAngle)},dir={x:Math.cos(knifeAngle),z:Math.sin(knifeAngle)},plans=bodies.filter(b=>b.slot===null).map(b=>cutPlan(b,point,normal,dir)).filter(Boolean);previewShares=plans.length?plans.map(p=>p.parts.map(poly=>(area(poly)*p.body.h/initialMasses[p.body.type]*100).toFixed(1)+'%').join(' / ')).join(' · '):'移动刀的位置，预览切后分量';previewAt=now}const p=window.__jelly.project(point.x,point.y+.4,point.z);cutEstimate.style.left=clamp(p.x,140,viewport.width-140)+'px';cutEstimate.style.top=clamp(p.y-42,160,viewport.height-180)+'px';cutEstimate.textContent=previewShares;}
}
function setTool(next){
  if(drag)releaseDrag();tool=next;
  for(const name of ['drag','cut']){$(name+'-tool').classList.toggle('active',name===tool);$(name+'-tool').setAttribute('aria-pressed',String(name===tool))}
  stroke=null;$('hint-text').textContent=tool==='drag'?'抓住果冻拉一拉 · 按住时滚轮扭转':'划一条线，松手下刀 · 点击也能切';
  if(viewport.mobile&&tool==='drag')$('hint-text').textContent='抓住果冻拉一拉 · 加一根手指可以扭转';
  $('angle-control').hidden=tool!=='cut';$('world').style.cursor=tool==='cut'?'crosshair':'grab';
}
function updateAngleLabel(){$('angle-value').textContent=Math.round(((knifeAngle*180/Math.PI)%180+180)%180)+'°'}
function rotateKnife(delta){if(cutAction)return;knifeAngle+=delta;updateAngleLabel()}

function getPointerWorld(e,height=0){
  if(e){pointer.x=e.clientX;pointer.y=e.clientY;pointer.ndc.set(e.clientX/viewport.width*2-1,-e.clientY/viewport.height*2+1);pointer.seen=true}
  raycaster.setFromCamera(pointer.ndc,camera);plane.constant=-height;const hit=raycaster.ray.intersectPlane(plane,v3());return hit||v3();
}
function pickBody(includeServed=false){raycaster.setFromCamera(pointer.ndc,camera);const hits=raycaster.intersectObjects(bodies.filter(b=>includeServed||b.slot===null).map(b=>b.mesh),false);return hits[0]||null}
function bladePlacement(){const hit=pickBody();return hit?hit.point.clone():getPointerWorld(null,FRUITS[flavor].height*.6)}
function pressPointer(e){
  if(e.pointerType==='touch'){
    activeTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(drag&&pointer.id!==e.pointerId){$('world').setPointerCapture(e.pointerId);const primary=activeTouches.get(pointer.id);if(primary)drag.touchAngle=Math.atan2(e.clientY-primary.y,e.clientX-primary.x);return}
  }
  if(e.button!==0||pointer.down||cutAction||paused||$('help-dialog').open||!['order','sandbox'].includes(mode)||ui?.state==='hint')return;
  $('world').focus({preventScroll:true});initAudio();getPointerWorld(e);pointer.down=true;pointer.id=e.pointerId;$('world').setPointerCapture(e.pointerId);
  if(tool==='cut'){const p=bladePlacement();stroke={start:p,end:p.clone(),x:e.clientX,y:e.clientY,moved:false};return}
  const hit=pickBody(mode==='order');if(!hit)return;
  const body=hit.object.userData.body;selected=body;refreshHUD();
  if(body.slot!==null){returnSlot(body.slot);return}
  const grabPlane=new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(v3()),hit.point);
  drag={body,patch:body.physics.createGrab(hit.point,{radius:Math.min(.82,Math.max(.35,body.radius*.42))}),target:hit.point.clone(),plane:grabPlane,height:hit.point.y,twist:0,rotation:new THREE.Quaternion(),touchAngle:null};
  playSound('grab');$('world').style.cursor='grabbing';$('hint-text').textContent=viewport.mobile?'继续拉，或加一根手指扭转。':'继续拉，或滚动滚轮扭转。';
}
function movePointer(e){
  if(e.pointerType==='touch'&&activeTouches.has(e.pointerId)){
    activeTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(drag&&activeTouches.size>1){const a=activeTouches.get(pointer.id),b=[...activeTouches].find(([id])=>id!==pointer.id)?.[1];if(a&&b){const angle=Math.atan2(b.y-a.y,b.x-a.x);if(drag.touchAngle!==null)twistGrab(Math.atan2(Math.sin(angle-drag.touchAngle),Math.cos(angle-drag.touchAngle)));drag.touchAngle=angle}}
  }
  if(pointer.down&&e.pointerId!==pointer.id)return;
  getPointerWorld(e);
  if(stroke){stroke.end.copy(getPointerWorld(null,stroke.start.y));if(Math.hypot(e.clientX-stroke.x,e.clientY-stroke.y)>9){stroke.moved=true;knifeAngle=Math.atan2(stroke.end.z-stroke.start.z,stroke.end.x-stroke.start.x);updateAngleLabel()}}
  if(drag){raycaster.setFromCamera(pointer.ndc,camera);const p=raycaster.ray.intersectPlane(drag.plane,v3());if(p)drag.target.set(clamp(p.x,-8.5,8.5),clamp(p.y,.12,6),clamp(p.z,-6,6))}
  if(mode==='order'&&drag)ui.setDropHover(dropAt(e.clientX,e.clientY));
}
function twistGrab(delta){if(!drag)return;drag.twist+=delta;drag.rotation.setFromAxisAngle(camera.getWorldDirection(v3()).negate(),drag.twist)}
function releaseDrag(){if(!drag)return;playSound('release');drag=null;$('world').style.cursor=tool==='cut'?'crosshair':'grab';$('hint-text').textContent='抓住果冻，慢慢拉开，再松手。'}
function releasePointer(e){
  if(e)activeTouches.delete(e.pointerId);else activeTouches.clear();
  if(e&&pointer.id!==null&&e.pointerId!==pointer.id){if(drag)drag.touchAngle=null;return}
  if(stroke&&e?.type==='pointerup'){const point=stroke.moved?stroke.start.clone().add(stroke.end).multiplyScalar(.5):stroke.start;startCut(point)}
  if(drag&&e?.type==='pointerup'&&mode==='order'){const b=drag.body;b.sync();if(b.min.y>.4&&b.vel.length()>1)b.tossed=true;const slot=dropAt(e.clientX,e.clientY);if(slot>=0)serveSelected(slot)}
  ui?.setDropHover(-1);
  stroke=null;pointer.down=false;pointer.id=null;releaseDrag();
}
function cancelInteraction(){pointer.down=false;pointer.id=null;drag=null;stroke=null;cutAction=null;activeTouches.clear()}
function cutPlan(body,point,normal,dir){
  const pose=body.pose(),inverse=pose.rotation.clone().invert();
  const p=point.clone().sub(pose.center).applyQuaternion(inverse).add(pose.restCenter),n=v3(normal.x,0,normal.z).applyQuaternion(inverse),length=Math.hypot(n.x,n.z);
  if(length<.08)return null;
  const k=(n.y*(body.h*.5-p.y))/(length*length),localPoint={x:p.x-n.x*k,z:p.z-n.z*k},localNormal={x:n.x/length,z:n.z/length};
  const localDir={x:localNormal.z,z:-localNormal.x},start={x:localPoint.x-localDir.x*30,z:localPoint.z-localDir.z*30},end={x:localPoint.x+localDir.x*30,z:localPoint.z+localDir.z*30};
  const crossing=bladeCrossing(body.poly,start,end);if(!crossing)return null;
  for(const q of [crossing.entry,crossing.exit]){const w=body.sampleRest({x:q.x,y:body.h*.5,z:q.z}),along=(w.x-point.x)*dir.x+(w.z-point.z)*dir.z;if(along< -3.60||along>4.16)return null}
  const parts=splitPolygon(body.poly,localPoint,localNormal,.13);return parts?{body,parts,localNormal}:null;
}
function startCut(point=bladePlacement()){
  if(cutAction)return;
  if(bodies.length>=36){toast('已经是一桌小果冻了。按 R 换一块新的。');return}
  const normal={x:-Math.sin(knifeAngle),z:Math.cos(knifeAngle)},dir={x:Math.cos(knifeAngle),z:Math.sin(knifeAngle)};
  const plans=bodies.filter(b=>b.slot===null).map(b=>cutPlan(b,point,normal,dir)).filter(Boolean);
  if(!plans.length){toast('把刀放在果冻上，或换个方向再切。');playSound('tap');return}
  pushHistory();cutAction={point,normal,dir,angle:knifeAngle,plans,targets:plans.map(p=>p.body),elapsed:0,didCut:false,top:Math.max(...plans.map(p=>p.body.max.y)),edgeY:Infinity};
}
function splitBodies(action){
  let made=0;const created=[];
  for(const plan of action.plans){const body=plan.body;
    if(!bodies.includes(body)||bodies.length>=36)continue;
    const parts=plan.parts;
    const index=bodies.indexOf(body);bodies.splice(index,1);
    for(let i=0;i<2;i++){
      const sign=i===0?1:-1;
      const piece=new Jelly(parts[i],body.type,{recipeScale:body.recipeScale,tossed:body.tossed,initializer:p=>{const binding=body.physics.bindPoint(p.x,p.y,p.z),position=body.physics.sample(binding),velocity=body.physics.sampleVelocity(binding);position.x+=action.normal.x*sign*.045;position.z+=action.normal.z*sign*.045;velocity.x+=action.normal.x*sign*.65;velocity.z+=action.normal.z*sign*.65;return{position,velocity}}});
      bodies.push(piece);created.push(piece);
    }
    if(selected===body)selected=null;body.destroy();made++;
  }
  if(made){cuts++;updateCounts();refreshHUD();playSound('cut',Math.min(1.3,.8+made*.1));spawnDroplets(action.point,flavor);if(navigator.vibrate)navigator.vibrate(12);if(cuts===1)toast(mode==='order'?'先点一小块看分量，再拖进餐盘。':'切开了。每一块都可以接着拽。');else if(cuts%10===0)toast(['再切小一点，也没关系。','时间慢下来，果冻晃起来。','这一刀，刚刚好。'][Math.floor(cuts/10)%3])}
  else{toast('这一块太小啦，换个位置试试。');playSound('tap')}
  return created;
}
function spawnDroplets(point,type){
  if(reducedMotion)return;
  for(let i=0;i<7;i++){
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(.026+Math.random()*.022,6,5),new THREE.MeshPhysicalMaterial({color:FRUITS[type].color,roughness:.22,clearcoat:1,transparent:true,opacity:.7}));mesh.position.copy(point);mesh.position.y=.6+Math.random()*.4;scene.add(mesh);droplets.push({mesh,vel:v3((Math.random()-.5)*2,1.5+Math.random()*2,(Math.random()-.5)*2),life:.45+Math.random()*.3})
  }
}

function solveContacts(){
  const active=bodies.filter(b=>b.slot===null);if(active.length<2)return;
  const cellSize=Math.max(...active.map(b=>b.contactRadius))*2.05,grid=new Map();
  // Positions are bounded to the tabletop; integer keys avoid allocating 27
  // coordinate strings for every surface particle at every physics step.
  const key=(x,y,z)=>(x+512)*1048576+(y+512)*1024+z+512;
  for(const body of active){
    const p=body.physics.positions;
    for(const id of body.surfaceIds){
      const j=id*3,cx=Math.floor(p[j]/cellSize),cy=Math.floor(p[j+1]/cellSize),cz=Math.floor(p[j+2]/cellSize);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++){
        const neighbors=grid.get(key(cx+dx,cy+dy,cz+dz));if(!neighbors)continue;
        for(const other of neighbors){
          if(other.body===body)continue;
          const q=other.body.physics.positions,k=other.id*3,radius=body.contactRadius+other.body.contactRadius;
          let nx=p[j]-q[k],ny=p[j+1]-q[k+1],nz=p[j+2]-q[k+2],distance=Math.hypot(nx,ny,nz);
          if(distance>=radius)continue;
          if(distance<1e-6){nx=body.pos.x-other.body.pos.x;ny=0;nz=body.pos.z-other.body.pos.z;distance=Math.hypot(nx,nz)||1;if(!nx&&!nz)nx=1}
          nx/=distance;ny/=distance;nz/=distance;
          const correction=Math.min(.045,(radius-distance)*.43),heldA=drag?.body===body,heldB=drag?.body===other.body,wa=heldA?.25:.5,wb=heldB?.25:.5,total=wa+wb;
          p[j]+=nx*correction*wa/total;p[j+1]=Math.max(.027,p[j+1]+ny*correction*wa/total);p[j+2]+=nz*correction*wa/total;
          q[k]-=nx*correction*wb/total;q[k+1]=Math.max(.027,q[k+1]-ny*correction*wb/total);q[k+2]-=nz*correction*wb/total;
          const va=body.physics.velocities,vb=other.body.physics.velocities,closing=(va[j]-vb[k])*nx+(va[j+1]-vb[k+1])*ny+(va[j+2]-vb[k+2])*nz;
          if(closing<0){const impulse=-closing*.52;va[j]+=nx*impulse*wa/total;va[j+1]+=ny*impulse*wa/total;va[j+2]+=nz*impulse*wa/total;vb[k]-=nx*impulse*wb/total;vb[k+1]-=ny*impulse*wb/total;vb[k+2]-=nz*impulse*wb/total}
        }
      }
      const cell=key(cx,cy,cz);if(!grid.has(cell))grid.set(cell,[]);grid.get(cell).push({body,id});
    }
  }
}
function simulate(dt){
  for(const b of bodies){
    if(b.slot!==null)continue;
    const held=drag?.body===b;
    const attachment=held?{...drag.patch,target:drag.target,rotation:drag.rotation,strength:.38,maxCorrection:.08}:null;
    const press=cutAction&&!cutAction.didCut&&cutAction.targets.includes(b)&&cutAction.elapsed>.19?{point:cutAction.point,normal:{x:cutAction.normal.x,y:0,z:cutAction.normal.z},edgeY:cutAction.edgeY,radius:.42,halfLength:3.9,strength:.50}:null;
    const impact=b.vel.y;
    b.physics.step(dt,{gravity:-14,firmness:1-softness,damping,grab:attachment,knife:press,floor:.027,iterations:4,friction:7,restitution:.13});
    b.sync();
    if(b.min.y<.033&&!b.lastFloor&&impact<-1.4&&time-lastLandSound>.09){playSound('land',Math.min(1,Math.abs(impact)/6));lastLandSound=time}b.lastFloor=b.min.y<.033;
    const xLimit=viewport.mobile?4.2:8.0,zLimit=viewport.mobile?4.2:5.4;
    const delta=v3(clamp(b.pos.x,-xLimit,xLimit)-b.pos.x,0,clamp(b.pos.z,-zLimit,zLimit)-b.pos.z);
    if(delta.lengthSq()>0){b.physics.translate(delta);const v=b.physics.velocities;for(let i=0;i<v.length;i+=3){if(delta.x)v[i]*=-.2;if(delta.z)v[i+2]*=-.2}}
  }
  solveContacts();
}

function updateKnife(dt){
  const visible=['order','sandbox'].includes(mode)&&(tool==='cut'||!!cutAction);knife.visible=visible;guide.visible=visible&&!cutAction;
  if(!visible)return;
  if(cutAction){
    const a=cutAction;a.elapsed+=dt;knife.rotation.y=-a.angle;knife.position.set(a.point.x,0,a.point.z);
    if(a.elapsed<.19){knife.position.y=lerp(a.top+.45,a.top-.06,smooth(0,.19,a.elapsed))}
    else if(a.elapsed<.48){const p=smooth(.19,.48,a.elapsed);knife.position.y=a.top-.06-p*.49}
    else{if(!a.didCut){a.didCut=true;splitBodies(a)}const p=smooth(.48,.59,a.elapsed);knife.position.y=lerp(a.top-.55,.09,p);if(a.elapsed>.63)knife.position.y=lerp(.09,a.top+.55,smooth(.63,.95,a.elapsed))}
    a.edgeY=knife.position.y+.07;
    if(a.elapsed>=.96)cutAction=null;
  }else{
    const pos=stroke?(stroke.moved?stroke.start.clone().add(stroke.end).multiplyScalar(.5):stroke.start):pointer.seen?bladePlacement():v3(0,FRUITS[flavor].height,.3);
    knife.position.lerp(v3(pos.x,Math.max(FRUITS[flavor].height,pos.y)+.60,pos.z),1-Math.exp(-20*dt));knife.rotation.y=-knifeAngle;
    guide.position.set(pos.x,stroke?stroke.start.y+.025:.028,pos.z);guide.rotation.y=-knifeAngle;
  }
}
function frame(now){
  requestAnimationFrame(frame);
  const dt=lastTime?Math.min((now-lastTime)/1000,.05):1/60;lastTime=now;
  if(document.hidden||$('help-dialog').open){accumulator=0;return}
  const active=['order','sandbox'].includes(mode)&&!['hint','onboarding'].includes(ui?.state);const simDt=paused||!active?0:dt*(slowMode?.25:1);time+=simDt;if(mode==='order'&&active&&!paused)orderElapsed+=dt;const start=performance.now();
  updateKnife(simDt);
  accumulator+=simDt;let steps=0;while(accumulator>=1/120&&steps<6){simulate(1/120);accumulator-=1/120;steps++}
  for(const b of bodies)if(b.slot===null||b.renderMeshState!==showMesh)b.render();
  for(let i=droplets.length-1;i>=0;i--){const d=droplets[i];d.life-=simDt;d.vel.y-=12*simDt;d.mesh.position.addScaledVector(d.vel,simDt);d.mesh.material.opacity=Math.min(.6,d.life*2);if(d.life<=0||d.mesh.position.y<0){scene.remove(d.mesh);d.mesh.geometry.dispose();d.mesh.material.dispose();droplets.splice(i,1)}}
  if(now-lastReadout>180){let volume=0,rest=0,energy=0;for(const b of bodies){const m=b.physics.metrics();volume+=m.volume;rest+=m.restVolume;energy+=m.kinetic;b.q=m.volumeRatio-1}if($('volume-value'))$('volume-value').textContent=(volume/rest*100).toFixed(1)+'%';if($('energy-value'))$('energy-value').textContent=energy.toFixed(2);lastReadout=now}
  if(ui){if(now-lastHUD>180){refreshHUD();lastHUD=now}updateBadges(now)}plating?.update(time);
  metrics.physicsMs=performance.now()-start;
  renderer.render(scene,camera);metrics.frames++;
  if(now-metrics.lastSample>1000){metrics.fps=Math.round(metrics.frames*1000/(now-metrics.lastSample));metrics.lastSample=now;metrics.frames=0}
}

function resize(){
  viewport={width:innerWidth,height:innerHeight,mobile:innerWidth<=650};
  const aspect=innerWidth/innerHeight,span=viewport.mobile?Math.max(11.4/aspect,16):13.8;
  camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;
  camera.position.set(9.2,13.6,17.7);
  const target=viewport.mobile?v3(0,-1.0,0):v3(.45,.05,0);camera.lookAt(target);camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight,false);
  if(viewport.mobile){camera.setViewOffset(innerWidth,innerHeight,0,innerHeight*.01,innerWidth,innerHeight)}else camera.clearViewOffset();
  if(drag)releaseDrag();
  if(order&&plating){plating.setSlots(order.slots,{mobile:viewport.mobile});order.slots.forEach((s,i)=>{const b=bodies.find(b=>b.slot===i);plating.setFilled(i,!!b,FRUITS[b?.type||s.flavor||flavor].color);if(b){const p=plating.target(i);b.translate(v3(p.x-b.pos.x,0,p.z-b.pos.z));b.render()}})}
}
function bindUI(){
  const canvas=$('world');canvas.addEventListener('pointerdown',pressPointer);canvas.addEventListener('pointermove',movePointer);canvas.addEventListener('pointerup',releasePointer);canvas.addEventListener('pointercancel',releasePointer);canvas.addEventListener('lostpointercapture',releasePointer);
  canvas.addEventListener('pointerleave',()=>{if(!pointer.down)pointer.seen=false});canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{if(drag){e.preventDefault();twistGrab(Math.sign(e.deltaY)*Math.PI/12)}else if(tool==='cut'){e.preventDefault();rotateKnife(Math.sign(e.deltaY)*Math.PI/18)}},{passive:false});
  $('drag-tool').onclick=()=>{initAudio();playSound('tap');setTool('drag')};$('cut-tool').onclick=()=>{initAudio();playSound('tap');setTool('cut')};
  $('rotate-left').onclick=()=>rotateKnife(-Math.PI/12);$('rotate-right').onclick=()=>rotateKnife(Math.PI/12);
  $('reset').onclick=()=>resetScene();$('jiggle').onclick=jiggle;
  $('softness').oninput=e=>{softness=Number(e.target.value)/100;$('soft-label').textContent=softness<.34?'弹弹弹':softness>.75?'软乎乎':'刚刚好'};
  $('damping').oninput=e=>{damping=Number(e.target.value)/100;$('damping-label').textContent=damping<.34?'晃悠悠':damping>.75?'慢慢停':'刚刚好'};
  $('slow-mode').onchange=e=>{slowMode=e.target.checked};$('mesh-mode').onchange=e=>{showMesh=e.target.checked};
  $('pause-mode').onclick=()=>{paused=!paused;releasePointer();$('pause-mode').textContent=paused?'继续':'暂停';$('pause-mode').setAttribute('aria-pressed',String(paused));accumulator=0};
  document.querySelectorAll('.flavor').forEach(button=>button.onclick=()=>{flavor=button.dataset.flavor;document.querySelectorAll('.flavor').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button))});resetScene(false);initAudio();playSound('release');toast(FRUITS[flavor].name+'，新鲜出炉。')});
  $('sound').onclick=()=>{soundEnabled=!soundEnabled;$('sound').classList.toggle('muted',!soundEnabled);$('sound').setAttribute('aria-label',soundEnabled?'关闭声音':'开启声音');$('sound').title=soundEnabled?'关闭声音 · M':'开启声音 · M';if(soundEnabled){initAudio();playSound('tap')}toast(soundEnabled?'声音已开启。软软的，刚刚好。':'已静音。安静地玩。')};
  const closeHelp=()=>{$('help-dialog').close();lastTime=0};
  $('help').onclick=()=>{releasePointer();$('help-dialog').showModal()};$('close-help').onclick=closeHelp;$('start-playing').onclick=closeHelp;
  $('help-dialog').addEventListener('click',e=>{const r=$('help-dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeHelp()});
  addEventListener('keydown',e=>{
    if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.repeat||$('help-dialog').open)return;
    if(e.code==='Escape'&&['order','sandbox'].includes(mode)&&ui?.state!=='hint'){openMenu();return}
    if(mode==='order'&&ui?.state==='order'){if(e.code==='KeyU'){e.preventDefault();undoAction();return}if(e.code==='Enter'&&!(e.target instanceof HTMLButtonElement)){e.preventDefault();submitOrder();return}}
    if(!['order','sandbox'].includes(mode)||ui?.state==='hint')return;
    if(e.code==='Space'){e.preventDefault();if(e.target instanceof HTMLButtonElement)return;spaceHeld=true;previousTool=tool;setTool('cut')}
    else if(e.code==='Digit1')setTool('drag');else if(e.code==='Digit2')setTool('cut');else if(e.code==='KeyR')resetScene();else if(e.code==='KeyJ')jiggle();else if(e.code==='KeyM')$('sound').click();else if(e.code==='KeyH')$('help').click();else if(e.code==='KeyQ')rotateKnife(-Math.PI/12);else if(e.code==='KeyE')rotateKnife(Math.PI/12);
  });
  addEventListener('keyup',e=>{if(e.code==='Space'&&spaceHeld){spaceHeld=false;setTool(previousTool)}});
  addEventListener('blur',()=>{releasePointer();if(spaceHeld){spaceHeld=false;setTool(previousTool)}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){releasePointer();lastTime=0;accumulator=0}});addEventListener('resize',resize);
  canvas.style.cursor='grab';
}

// A read-only inspection surface for reproducible physics and browser verification.
window.__jelly={get state(){return{mode,uiState:ui?.state,order:order?{...order}:null,profile:profile?JSON.parse(JSON.stringify(profile)):null,elapsed:orderElapsed,historyDepth:history.length,selectedId:selected?.id,initialMasses:{...initialMasses},flavor,tool,cuts,pieces:bodies.length,softness,damping,paused,slowMode,showMesh,dragging:!!drag,grabTarget:drag?drag.target.toArray():null,twist:drag?.twist??0,stroking:!!stroke,cutting:!!cutAction,cutProgress:cutAction?.elapsed??0,knife:{x:knife.position.x,y:knife.position.y,z:knife.position.z,angle:knifeAngle},metrics:{...metrics},bodies:bodies.map(b=>({id:b.id,flavor:b.type,recipeScale:b.recipeScale,height:b.h,poly:b.poly.map(p=>({...p})),mass:b.area*b.h,share:order?shareOf(b):100,rindFraction:rindOf(b),slot:b.slot,tossed:b.tossed,area:b.area,position:b.pos.toArray(),velocity:b.vel.toArray(),deformation:b.q,vertices:b.geometry.attributes.position.count,...b.physics.metrics(),rotation:b.physics.getPose().quaternion}))}},project(x,y,z){const p=v3(x,y,z).project(camera);return{x:(p.x+1)*viewport.width/2,y:(1-p.y)*viewport.height/2}},projectRest(id,x,y,z){const b=bodies.find(b=>b.id===id);if(!b)return null;const p=b.sampleRest({x,y,z});return this.project(p.x,p.y,p.z)},preview(point,angle){const normal={x:-Math.sin(angle),z:Math.cos(angle)},dir={x:Math.cos(angle),z:Math.sin(angle)};return bodies.filter(b=>b.slot===null).map(b=>cutPlan(b,v3(point.x,point.y??.5,point.z),normal,dir)).filter(Boolean).map(plan=>({id:plan.body.id,parts:plan.parts.map(poly=>({poly,share:area(poly)*plan.body.h/(initialMasses[plan.body.type]||plan.body.area*plan.body.h)*100}))}))},get centers(){return bodies.filter(b=>b.slot===null).map(b=>{const projected=b.pos.clone().project(camera);return{id:b.id,x:(projected.x+1)*viewport.width/2,y:(1-projected.y)*viewport.height/2}})}};
init();
