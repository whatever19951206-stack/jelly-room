import * as THREE from 'three';

// The tray's X axis runs horizontally in the game's fixed camera view.
const AZIMUTH=Math.atan2(9.2,17.7),C=Math.cos(AZIMUTH),S=Math.sin(AZIMUTH);
const FLOOR=.027;
const FLAVOR_COLORS={melon:'#c96979',citrus:'#c89a43',grape:'#a58abd'};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const finite=(n,fallback=0)=>Number.isFinite(n)?n:fallback;
function frame({mobile=false,sourceCount=1}={}){
  return{halfWidth:mobile?2.65:3.55,halfDepth:mobile?1.65:1.8,front:sourceCount>1?4.05:3.9};
}
function world(right,front,y=FLOOR){return{x:right*C+front*S,y,z:-right*S+front*C}}

/** Slot positions use the campaign's normalized [-1,1] X/Z coordinates. */
export function platingLayout(slots,options={}){
  const f=frame(options),count=Math.min(6,slots.length),result=[];
  for(let i=0;i<count;i++){
    const fallback=count<=3?{x:count===1?0:(i/(count-1)-.5)*1.25,z:0}:{x:((i%3)-1)*.65,z:Math.floor(i/3)? .4:-.4};
    const p=slots[i]?.position,x=clamp(finite(p?.x,fallback.x),-1,1),z=clamp(finite(p?.z,fallback.z),-1,1);
    result.push({...world(x*f.halfWidth,f.front+z*f.halfDepth),normalized:{x,z},right:x*f.halfWidth,front:z*f.halfDepth,index:i,radius:0});
  }
  // Leave a fine gap between plates even for a compact arc or four-in-a-row.
  let nearest=Infinity;
  for(let i=0;i<count;i++)for(let j=i+1;j<count;j++)nearest=Math.min(nearest,Math.hypot(result[i].x-result[j].x,result[i].z-result[j].z));
  const preferred=count===1?1.28:count===2?1.06:count===3?.87:.76;
  const radius=Math.min(preferred*(options.mobile?.91:1),Math.max(.30,nearest*.43));
  for(const p of result)p.radius=radius;
  return result;
}

/** Centers for one or two whole source jellies, separate from the serving area. */
export function sourcePositions(count=1,{mobile=false}={}){
  count=clamp(Math.round(count),1,3);
  if(count===1)return[world(-.28,-1.25,.04)];
  const spread=mobile?1.92:2.1;
  return Array.from({length:count},(_,i)=>world((i-(count-1)/2)*spread*2,-1.55-(count===3&&i===1?.8:0),.04));
}

function numberTexture(index){
  if(typeof document==='undefined')return null;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d');if(!ctx)return null;
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  function draw(filled){
    ctx.clearRect(0,0,128,128);ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.beginPath();ctx.arc(64,64,57,0,Math.PI*2);ctx.fillStyle=filled?'#e6eddc':'#f6f2e8';ctx.fill();
    ctx.strokeStyle=filled?'#a6b498':'#d8d2c2';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle=filled?'#58724f':'#827e6a';ctx.font='600 86px Arial, sans-serif';
    ctx.fillText(String.fromCharCode(65+index),64,68);
    texture.needsUpdate=true;
  }
  draw(false);return{texture,draw};
}

/**
 * Low-profile serving coasters. They never change the physical floor height.
 * target(index) returns a fresh {x,y:.027,z}; its Y is a ground reference,
 * not the jelly's center of mass. setSlots(newSlots) resets filled state;
 * setSlots(theSameArray) preserves it for responsive layout updates.
 */
export function createPlating(scene){
  const root=new THREE.Group();root.name='serving-trays';scene.add(root);
  const plateGeometry=new THREE.CylinderGeometry(1,1.009,.014,64);
  const rimGeometry=new THREE.RingGeometry(.970,1.001,64);
  const guideGeometry=new THREE.RingGeometry(.760,.765,64);
  const washGeometry=new THREE.CircleGeometry(.75,64);
  const flashGeometry=new THREE.RingGeometry(1.022,1.036,64);
  const plateMaterial=new THREE.MeshStandardMaterial({color:'#f2eedf',roughness:.83,metalness:0});
  const rimMaterial=new THREE.MeshBasicMaterial({color:'#c8c4b5',transparent:true,opacity:.7,depthWrite:false});
  let entries=[],layout=[],lastSlots=null,configuration={},clock=0,disposed=false;

  function flat(geometry,material,y){const mesh=new THREE.Mesh(geometry,material);mesh.rotation.x=-Math.PI/2;mesh.position.y=y;return mesh}
  function removeEntries(){
    for(const entry of entries){root.remove(entry.group);entry.guide.material.dispose();entry.wash.material.dispose();entry.flash.material.dispose();entry.label?.material.dispose();entry.number?.texture.dispose()}
    entries=[];
  }
  const api={
    setSlots(slots=[],options={}){
      if(disposed)return api;
      const previous=new Map(lastSlots===slots?entries.map(e=>[e.id,{filled:e.filled,color:e.color}]):[]);
      removeEntries();configuration={...options};layout=platingLayout(slots,configuration);lastSlots=slots;
      for(let i=0;i<layout.length;i++){
        const descriptor=slots[i]??{},position=layout[i],group=new THREE.Group(),r=position.radius;
        group.name=`serving-slot-${descriptor.id??i+1}`;group.position.set(position.x,0,position.z);group.rotation.y=AZIMUTH;root.add(group);
        const plate=new THREE.Mesh(plateGeometry,plateMaterial);plate.scale.set(r,1,r);plate.position.y=.009;plate.receiveShadow=true;group.add(plate);
        const rim=flat(rimGeometry,rimMaterial,.017);rim.scale.set(r,r,1);group.add(rim);
        const wash=flat(washGeometry,new THREE.MeshBasicMaterial({color:FLAVOR_COLORS[descriptor.flavor]??'#9aa78a',transparent:true,opacity:.035,depthWrite:false}),.0175);wash.scale.set(r,r,1);group.add(wash);
        const guide=flat(guideGeometry,new THREE.MeshBasicMaterial({color:'#adae9b',transparent:true,opacity:.50,depthWrite:false}),.019);guide.scale.set(r,r,1);group.add(guide);
        const flash=flat(flashGeometry,new THREE.MeshBasicMaterial({color:'#9eb38e',transparent:true,opacity:0,depthWrite:false}),.020);flash.scale.set(r,r,1);group.add(flash);
        const number=numberTexture(i);let label=null;
        if(number){label=new THREE.Sprite(new THREE.SpriteMaterial({map:number.texture,transparent:true,depthWrite:false,depthTest:false,toneMapped:false}));label.position.set(0,.065,r*1.07);const size=options.mobile?.47:.34;label.scale.set(size,size,1);label.renderOrder=3;group.add(label)}
        const id=descriptor.id??i,entry={id,index:i,group,plate,rim,wash,guide,flash,number,label,radius:r,filled:false,color:null,filledAt:-Infinity};
        entries.push(entry);
        const prior=previous.get(id),filled=typeof descriptor.filled==='boolean'?descriptor.filled:prior?.filled??false;
        if(filled)api.setFilled(i,true,descriptor.color??prior?.color);
      }
      return api;
    },
    target(index){const p=layout[index];return p?{x:p.x,y:FLOOR,z:p.z}:null},
    worldToNormalized(point){
      const f=frame(configuration),right=point.x*C-point.z*S,front=point.x*S+point.z*C;
      return{x:right/f.halfWidth,z:(front-f.front)/f.halfDepth};
    },
    setFilled(index,filled,color){
      const e=entries[index];if(!e)return api;
      const changed=e.filled!==Boolean(filled);e.filled=Boolean(filled);
      if(color!==undefined&&color!==null){e.color=color;e.wash.material.color.set(color)}
      e.wash.material.opacity=e.filled?.09:.035;e.guide.material.color.set(e.filled?'#8fa580':'#adae9b');e.number?.draw(e.filled);
      if(changed&&e.filled)e.filledAt=clock;else if(!e.filled)e.filledAt=-Infinity;
      return api;
    },
    setVisible(visible){root.visible=Boolean(visible);return api},
    update(time){
      clock=finite(time,clock);
      if(!root.visible)return;
      for(const e of entries){
        e.guide.material.opacity=e.filled?.32:.41+Math.sin(clock*1.45+e.index*.36)*.045;
        const age=Math.max(0,clock-e.filledAt),pulse=e.filled&&age<1.15?Math.sin(Math.PI*age/1.15)*Math.exp(-age*1.7):0;
        e.flash.visible=pulse>0;e.flash.material.opacity=pulse*.75;const s=e.radius*(1+Math.min(age,1.15)*.10);e.flash.scale.set(s,s,1);
      }
    },
    dispose(){
      if(disposed)return;disposed=true;removeEntries();scene.remove(root);
      for(const geometry of [plateGeometry,rimGeometry,guideGeometry,washGeometry,flashGeometry])geometry.dispose();
      plateMaterial.dispose();rimMaterial.dispose();layout=[];lastSlots=null;
    }
  };
  return api;
}

export default createPlating;
