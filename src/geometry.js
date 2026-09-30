// Convex polygon clipping keeps each fresh cut as real, independently draggable geometry.
export const EPS = 1e-7;
export function area(poly) { let a=0;for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];a+=p.x*q.z-q.x*p.z}return Math.abs(a)*.5 }
export function centroid(poly) {
  let a=0,x=0,z=0;for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],s=p.x*q.z-q.x*p.z;a+=s;x+=(p.x+q.x)*s;z+=(p.z+q.z)*s}
  return Math.abs(a)<EPS?{x:poly[0].x,z:poly[0].z}:{x:x/(3*a),z:z/(3*a)};
}
export function signedDistance(p,point,normal){return (p.x-point.x)*normal.x+(p.z-point.z)*normal.z}
export function clip(poly,point,normal,side) {
  const out=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=signedDistance(a,point,normal)*side,db=signedDistance(b,point,normal)*side;
    if(da>=-EPS)out.push({...a});
    if((da>EPS&&db<-EPS)||(da<-EPS&&db>EPS)){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t})}
  }
  return out.filter((p,i)=>{const q=out[(i+out.length-1)%out.length];return Math.hypot(p.x-q.x,p.z-q.z)>EPS});
}
export function splitPolygon(poly,point,normal,minArea=.12){const a=clip(poly,point,normal,1),b=clip(poly,point,normal,-1);return a.length>=3&&b.length>=3&&area(a)>=minArea&&area(b)>=minArea?[a,b]:null}

// A finite knife has to pass through both boundaries. Merely intersecting the
// polygon, or extending its infinite line across it, is not a complete cut.
export function bladeCrossing(poly,start,end) {
  const dx=end.x-start.x,dz=end.z-start.z,length=Math.hypot(dx,dz);
  if(poly.length<3||!Number.isFinite(length)||length<EPS)return null;
  const direction={x:dx/length,z:dz/length};
  const normal={x:-direction.z,z:direction.x};
  const distances=poly.map(p=>signedDistance(p,start,normal));
  if(Math.min(...distances)>=-EPS||Math.max(...distances)<=EPS)return null;

  let first=Infinity,last=-Infinity;
  const include=p=>{
    const along=(p.x-start.x)*direction.x+(p.z-start.z)*direction.z;
    first=Math.min(first,along);last=Math.max(last,along);
  };
  for(let i=0;i<poly.length;i++){
    const j=(i+1)%poly.length,a=poly[i],b=poly[j],da=distances[i],db=distances[j];
    if(Math.abs(da)<=EPS)include(a);
    if((da>EPS&&db<-EPS)||(da<-EPS&&db>EPS)){
      const t=da/(da-db);include({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
    }
  }
  if(!Number.isFinite(first)||last-first<=EPS||first<-EPS||last>length+EPS)return null;
  return {
    point:{x:start.x,z:start.z},normal,
    entry:{x:start.x+direction.x*first,z:start.z+direction.z*first},
    exit:{x:start.x+direction.x*last,z:start.z+direction.z*last}
  };
}

export function splitPolygonByBlade(poly,start,end,minArea=.12) {
  const crossing=bladeCrossing(poly,start,end);
  return crossing?splitPolygon(poly,crossing.point,crossing.normal,minArea):null;
}

// Match the body's pose: position is its world centroid, and center is the
// centroid retained in the original polygon's coordinate system.
export function worldPointToLocal(point,{position,angle=0,center={x:0,z:0}}) {
  const c=Math.cos(angle),s=Math.sin(angle),x=point.x-position.x,z=point.z-position.z;
  return {x:c*x+s*z+center.x,z:-s*x+c*z+center.z};
}
export function localPointToWorld(point,{position,angle=0,center={x:0,z:0}}) {
  const c=Math.cos(angle),s=Math.sin(angle),x=point.x-center.x,z=point.z-center.z;
  return {x:position.x+c*x-s*z,z:position.z+s*x+c*z};
}
export function splitPolygonByWorldBlade(poly,start,end,pose,minArea=.12) {
  return splitPolygonByBlade(poly,worldPointToLocal(start,pose),worldPointToLocal(end,pose),minArea);
}

export function contains(poly,p){let sign=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],c=(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);if(Math.abs(c)<EPS)continue;if(sign&&sign*c<0)return false;sign=c}return true}
export function resample(poly,spacing=.22){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/spacing));for(let j=0;j<n;j++)out.push({x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n})}return out}
export function overlapSAT(a,b){
  let depth=Infinity,best=null;
  for(const poly of [a,b])for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length],len=Math.hypot(q.x-p.x,q.z-p.z);
    if(len<EPS)continue;
    const nx=-(q.z-p.z)/len,nz=(q.x-p.x)/len;
    let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;
    for(const v of a){const d=v.x*nx+v.z*nz;amin=Math.min(amin,d);amax=Math.max(amax,d)}
    for(const v of b){const d=v.x*nx+v.z*nz;bmin=Math.min(bmin,d);bmax=Math.max(bmax,d)}
    // The overlap interval alone underestimates penetration when one polygon
    // contains another. Measure the displacement to either separating side.
    const forward=amax-bmin,backward=bmax-amin;
    if(forward<=0||backward<=0)return null;
    const d=Math.min(forward,backward);
    if(d<depth){
      const sign=forward<backward?1:forward>backward?-1:(bmin+bmax>=amin+amax?1:-1);
      depth=d;best={x:nx*sign,z:nz*sign};
    }
  }
  return best?{normal:best,depth}:null;
}
