// A small dependency-free volumetric XPBD solver. All public coordinates are world
// coordinates except `rest` and bindPoint/sampleRest inputs (the original fruit).
import { area, contains, centroid } from './geometry.js';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const xyz=(v,fallback=0)=>Array.isArray(v)||ArrayBuffer.isView(v)?[v[0],v[1],v[2]]:[v?.x??fallback,v?.y??fallback,v?.z??fallback];
function write(out,x,y,z){if(!out)return{x,y,z};if(out.set&& !ArrayBuffer.isView(out)){out.set(x,y,z)}else if(Array.isArray(out)||ArrayBuffer.isView(out)){out[0]=x;out[1]=y;out[2]=z}else{out.x=x;out.y=y;out.z=z}return out}

// Bowyer-Watson triangulation of the convex outline plus a staggered grid.
function triangulate(input){
  const points=input.map(p=>({...p}));
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  for(const p of points){minX=Math.min(minX,p.x);minZ=Math.min(minZ,p.z);maxX=Math.max(maxX,p.x);maxZ=Math.max(maxZ,p.z)}
  const cx=(minX+maxX)/2,cz=(minZ+maxZ)/2,r=Math.max(maxX-minX,maxZ-minZ,1)*16,n=points.length;
  points.push({x:cx-r,z:cz-r},{x:cx+r,z:cz-r},{x:cx,z:cz+r});
  function triangle(a,b,c){
    const p=points[a],q=points[b],s=points[c],d=2*(p.x*(q.z-s.z)+q.x*(s.z-p.z)+s.x*(p.z-q.z));
    if(Math.abs(d)<1e-12)return null;
    const pp=p.x*p.x+p.z*p.z,qq=q.x*q.x+q.z*q.z,ss=s.x*s.x+s.z*s.z;
    const x=(pp*(q.z-s.z)+qq*(s.z-p.z)+ss*(p.z-q.z))/d,z=(pp*(s.x-q.x)+qq*(p.x-s.x)+ss*(q.x-p.x))/d;
    return{a,b,c,x,z,r2:(p.x-x)**2+(p.z-z)**2};
  }
  let triangles=[triangle(n,n+1,n+2)];
  for(let i=0;i<n;i++){
    const p=points[i],edges=new Map(),keep=[];
    for(const t of triangles){
      if((p.x-t.x)**2+(p.z-t.z)**2<=t.r2+1e-10){
        for(const [a,b] of [[t.a,t.b],[t.b,t.c],[t.c,t.a]]){const key=a<b?`${a}:${b}`:`${b}:${a}`;if(edges.has(key))edges.delete(key);else edges.set(key,[a,b])}
      }else keep.push(t);
    }
    for(const [a,b] of edges.values()){const t=triangle(a,b,i);if(t)keep.push(t)}
    triangles=keep;
  }
  return triangles.filter(t=>t.a<n&&t.b<n&&t.c<n).map(t=>[t.a,t.b,t.c]);
}

function mesh(poly,height,spacing){
  const points=[],seen=new Set();
  const add=p=>{const key=`${Math.round(p.x*1e8)}:${Math.round(p.z*1e8)}`;if(!seen.has(key)){points.push(p);seen.add(key)}};
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/spacing));
    for(let j=0;j<count;j++)add({x:a.x+(b.x-a.x)*j/count,z:a.z+(b.z-a.z)*j/count});
    minX=Math.min(minX,a.x);minZ=Math.min(minZ,a.z);maxX=Math.max(maxX,a.x);maxZ=Math.max(maxZ,a.z);
  }
  const edgeDistance=p=>{let d=Infinity;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],dx=b.x-a.x,dz=b.z-a.z,t=clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz),0,1);d=Math.min(d,Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz))}return d};
  let row=0;
  for(let z=minZ+spacing*.5;z<maxZ;z+=spacing*Math.sqrt(3)/2,row++)for(let x=minX+spacing*(.5+(row%2)*.5);x<maxX;x+=spacing){const p={x,z};if(contains(poly,p)&&edgeDistance(p)>spacing*.22)add(p)}
  // Very small/slender fragments still need a genuine interior, not just a shell.
  if(points.length<5)add(centroid(poly));
  const triangles=triangulate(points),layers=Math.max(2,Math.ceil(height/spacing)),n=points.length;
  const rest=new Float64Array(n*(layers+1)*3);
  for(let y=0;y<=layers;y++)for(let i=0;i<n;i++){const j=(y*n+i)*3;rest[j]=points[i].x;rest[j+1]=height*y/layers;rest[j+2]=points[i].z}
  const tets=[];
  function push(a,b,c,d){const v=det(rest,a,b,c,d);if(Math.abs(v)<1e-12)return;if(v<0)[b,c]=[c,b];tets.push(a,b,c,d)}
  for(let y=0;y<layers;y++)for(const tri of triangles){
    // Globally sorted vertices give neighboring prisms the same face diagonal.
    const [i,j,k]=[...tri].sort((a,b)=>a-b),a=y*n+i,b=y*n+j,c=y*n+k,A=a+n,B=b+n,C=c+n;
    push(a,b,c,A);push(b,c,A,B);push(c,A,B,C);
  }
  return{rest,tets:new Uint32Array(tets),spacing,layers};
}

function det(p,a,b,c,d){
  a*=3;b*=3;c*=3;d*=3;
  const bx=p[b]-p[a],by=p[b+1]-p[a+1],bz=p[b+2]-p[a+2],cx=p[c]-p[a],cy=p[c+1]-p[a+1],cz=p[c+2]-p[a+2],dx=p[d]-p[a],dy=p[d+1]-p[a+1],dz=p[d+2]-p[a+2];
  return bx*(cy*dz-cz*dy)+by*(cz*dx-cx*dz)+bz*(cx*dy-cy*dx);
}

function rotate(q,x,y,z){const qx=q.x??q[0],qy=q.y??q[1],qz=q.z??q[2],qw=q.w??q[3],tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x);return[x+qw*tx+qy*tz-qz*ty,y+qw*ty+qz*tx-qx*tz,z+qw*tz+qx*ty-qy*tx]}

export class SoftBody{
  constructor(poly,height,options={}){
    if(poly.length<3||area(poly)<1e-6||!(height>0))throw new Error('SoftBody requires a non-degenerate convex polygon and positive height');
    this.poly=poly.map(p=>({...p}));this.height=height;this.options=options;
    this.spacing=options.spacing??Math.cbrt(area(poly)*height/(options.targetParticles??420)*1.65);
    const built=mesh(poly,height,this.spacing);
    this.rest=built.rest;this.tetrahedra=built.tets;this.count=this.rest.length/3;this.positions=new Float64Array(this.rest);this.velocities=new Float64Array(this.rest.length);this.previous=new Float64Array(this.rest.length);
    this.invMass=new Float64Array(this.count).fill(1);this.inverseMasses=this.invMass;this.masses=new Float64Array(this.count);
    this.floor=options.floor??.025;this.iterations=options.iterations??4;this.firmness=options.firmness??.5;this.damping=options.damping??.45;
    const offset=xyz(options.offset??options.position),velocity=xyz(options.velocity);
    for(let i=0;i<this.count;i++){
      const j=i*3,initial=options.initializer?.({x:this.rest[j],y:this.rest[j+1],z:this.rest[j+2]},i),p=initial?.position?xyz(initial.position):[this.rest[j]+offset[0],this.rest[j+1]+offset[1],this.rest[j+2]+offset[2]],v=initial?.velocity?xyz(initial.velocity):velocity;
      for(let k=0;k<3;k++){this.positions[j+k]=p[k];this.velocities[j+k]=v[k]}
    }
    this.previous.set(this.positions);
    const edgeMap=new Map(),faces=new Map(),tetCount=this.tetrahedra.length/4;
    this.restVolumes=new Float64Array(tetCount);this.volumeLambda=new Float64Array(tetCount);this.bindingData=new Float64Array(tetCount*12);this.restVolume=0;
    for(let t=0;t<tetCount;t++){
      const ids=Array.from(this.tetrahedra.subarray(t*4,t*4+4)),[a,b,c,d]=ids,v=det(this.rest,a,b,c,d)/6;this.restVolumes[t]=v;this.restVolume+=v;
      for(const id of ids)this.masses[id]+=v/4;
      for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){const lo=Math.min(ids[i],ids[j]),hi=Math.max(ids[i],ids[j]);edgeMap.set(`${lo}:${hi}`,[lo,hi])}
      for(const face of [[a,c,b],[a,b,d],[a,d,c],[b,c,d]]){const key=[...face].sort((x,y)=>x-y).join(':');if(faces.has(key))faces.delete(key);else faces.set(key,face)}
      const A=a*3,B=b*3,C=c*3,D=d*3,p=this.rest,bx=p[B]-p[A],by=p[B+1]-p[A+1],bz=p[B+2]-p[A+2],cx=p[C]-p[A],cy=p[C+1]-p[A+1],cz=p[C+2]-p[A+2],dx=p[D]-p[A],dy=p[D+1]-p[A+1],dz=p[D+2]-p[A+2],den=v*6,o=t*12;
      this.bindingData.set([p[A],p[A+1],p[A+2],(cy*dz-cz*dy)/den,(cz*dx-cx*dz)/den,(cx*dy-cy*dx)/den,(dy*bz-dz*by)/den,(dz*bx-dx*bz)/den,(dx*by-dy*bx)/den,(by*cz-bz*cy)/den,(bz*cx-bx*cz)/den,(bx*cy-by*cx)/den],o);
    }
    this.surfaceTriangles=new Uint32Array([...faces.values()].flat());
    const edges=[...edgeMap.values()];this.edges=new Uint32Array(edges.flat());this.edgeLengths=new Float64Array(edges.length);this.edgeLambda=new Float64Array(edges.length);this.edgeStiffness=new Float64Array(edges.length).fill(1);
    edges.forEach(([a,b],i)=>{
      a*=3;b*=3;this.edgeLengths[i]=Math.hypot(this.rest[a]-this.rest[b],this.rest[a+1]-this.rest[b+1],this.rest[a+2]-this.rest[b+2]);
      // Evaluate material properties once in rest coordinates. A stiff rind
      // follows the material through twists, remeshing and subsequent cuts.
      if(options.stiffnessAt){const stiffness=options.stiffnessAt({x:(this.rest[a]+this.rest[b])*.5,y:(this.rest[a+1]+this.rest[b+1])*.5,z:(this.rest[a+2]+this.rest[b+2])*.5});if(Number.isFinite(stiffness))this.edgeStiffness[i]=Math.max(1,stiffness)}
    });
    this.restCenter=this._centerOf(this.rest);this._poseQuaternion={x:0,y:0,z:0,w:1};this.sleeping=false;
  }

  _centerOf(p,out){let x=0,y=0,z=0;for(let i=0;i<this.count;i++){const m=this.masses[i];x+=p[i*3]*m;y+=p[i*3+1]*m;z+=p[i*3+2]*m}return write(out,x/this.restVolume,y/this.restVolume,z/this.restVolume)}
  center(out){return this._centerOf(this.positions,out)}

  /** Bind an arbitrary rest-space point; slight surface overhangs extrapolate. */
  bindPoint(x,y,z){
    if(typeof x==='object'){const p=xyz(x);[x,y,z]=p}
    let best=Infinity,bt=0,bw=[1,0,0,0];const data=this.bindingData;
    for(let t=0;t<this.restVolumes.length;t++){
      const o=t*12,dx=x-data[o],dy=y-data[o+1],dz=z-data[o+2],b=data[o+3]*dx+data[o+4]*dy+data[o+5]*dz,c=data[o+6]*dx+data[o+7]*dy+data[o+8]*dz,d=data[o+9]*dx+data[o+10]*dy+data[o+11]*dz,a=1-b-c-d;
      const penalty=Math.max(0,-a,-b,-c,-d,a-1,b-1,c-1,d-1);
      if(penalty<best){best=penalty;bt=t;bw=[a,b,c,d];if(best<1e-7)break}
    }
    return{indices:this.tetrahedra.slice(bt*4,bt*4+4),weights:new Float64Array(bw),tetrahedron:bt};
  }
  sampleRest(x,y,z){return this.bindPoint(x,y,z)}
  _sample(array,binding,out){let x=0,y=0,z=0;for(let i=0;i<4;i++){const j=binding.indices[i]*3,w=binding.weights[i];x+=array[j]*w;y+=array[j+1]*w;z+=array[j+2]*w}return write(out,x,y,z)}
  sample(binding,out){return this._sample(this.positions,binding,out)}
  evaluateBinding(binding,out){return this.sample(binding,out)}
  sampleVelocity(binding,out){return this._sample(this.velocities,binding,out)}

  /** Patch offsets are captured in world space. Optional grab.rotation rotates them. */
  createGrab(point,{radius=this.spacing*1.8,maxParticles=48}={}){
    const [x,y,z]=xyz(point),p=this.positions,candidates=[];
    for(let i=0;i<this.count;i++){const j=i*3,d=Math.hypot(p[j]-x,p[j+1]-y,p[j+2]-z);if(d<radius)candidates.push({id:i,d})}
    if(!candidates.length){let best=Infinity,id=0;for(let i=0;i<this.count;i++){const j=i*3,d=Math.hypot(p[j]-x,p[j+1]-y,p[j+2]-z);if(d<best){best=d;id=i}}candidates.push({id,d:best})}
    candidates.sort((a,b)=>a.d-b.d);candidates.length=Math.min(maxParticles,candidates.length);
    const ids=new Uint32Array(candidates.length),weights=new Float64Array(candidates.length),offsets=new Float64Array(candidates.length*3);
    candidates.forEach(({id,d},i)=>{ids[i]=id;weights[i]=Math.max(.08,Math.exp(-3*d*d/(radius*radius)));offsets.set([p[id*3]-x,p[id*3+1]-y,p[id*3+2]-z],i*3)});
    return{ids,weights,offsets,restOffsets:offsets,target:{x,y,z},radius};
  }

  /** Adds linear velocity and angular velocity (radians/s) about the current COM. */
  applyImpulse(linear,angular){const [x,y,z]=xyz(linear),[ax,ay,az]=xyz(angular),c=this.center(),p=this.positions,v=this.velocities;for(let i=0;i<this.count;i++){const j=i*3,rx=p[j]-c.x,ry=p[j+1]-c.y,rz=p[j+2]-c.z;v[j]+=x+ay*rz-az*ry;v[j+1]+=y+az*rx-ax*rz;v[j+2]+=z+ax*ry-ay*rx}this.sleeping=false;return this}
  translate(delta){const d=xyz(delta);for(let i=0;i<this.positions.length;i++){this.positions[i]+=d[i%3];this.previous[i]+=d[i%3]}return this}

  step(dt,{gravity=-9.8,firmness=this.firmness,damping=this.damping,grab=null,knife=null,floor=this.floor,iterations=this.iterations,contacts=null,friction=5,restitution=.08}={}){
    if(!(dt>0))return;dt=Math.min(dt,1/30);
    // The user damping control damps *deformation*, never whole-body velocity.
    // A fixed, tiny air loss avoids perpetual flight without changing the feel.
    const p=this.positions,v=this.velocities,old=this.previous,w=this.invMass,n=this.count,decay=Math.exp(-.025*dt),g=typeof gravity==='number'?[0,gravity,0]:xyz(gravity);
    old.set(p);this.edgeLambda.fill(0);this.volumeLambda.fill(0);
    for(let i=0;i<n;i++){const j=i*3;if(!w[i])continue;for(let k=0;k<3;k++){v[j+k]=(v[j+k]+g[k]*dt)*decay;p[j+k]+=v[j+k]*dt}}
    const firm=clamp(firmness,0,1),edgeAlpha=(.000001+.000085*(1-firm)**3)/(dt*dt),volumeAlpha=(.000000001+.000000002*(1-firm))/(dt*dt);
    const ids=this.edges,lengths=this.edgeLengths,el=this.edgeLambda,tets=this.tetrahedra,vols=this.restVolumes,vl=this.volumeLambda;
    for(let iteration=0;iteration<iterations;iteration++){
      // Reverse alternate passes to avoid visible one-direction bias in the mesh.
      for(let e=0;e<lengths.length;e++){
        const k=iteration%2?lengths.length-1-e:e,ia=ids[k*2],ib=ids[k*2+1],a=ia*3,b=ib*3,dx=p[a]-p[b],dy=p[a+1]-p[b+1],dz=p[a+2]-p[b+2],len=Math.hypot(dx,dy,dz);if(len<1e-10)continue;
        const alpha=edgeAlpha/this.edgeStiffness[k],dl=(-(len-lengths[k])-alpha*el[k])/(w[ia]+w[ib]+alpha);el[k]+=dl;const scale=dl/len,sa=scale*w[ia],sb=scale*w[ib];
        p[a]+=dx*sa;p[a+1]+=dy*sa;p[a+2]+=dz*sa;p[b]-=dx*sb;p[b+1]-=dy*sb;p[b+2]-=dz*sb;
      }
      for(let t=0;t<vols.length;t++){
        const ia=tets[t*4],ib=tets[t*4+1],ic=tets[t*4+2],id=tets[t*4+3],a=ia*3,b=ib*3,c=ic*3,d=id*3;
        const bx=p[b]-p[a],by=p[b+1]-p[a+1],bz=p[b+2]-p[a+2],cx=p[c]-p[a],cy=p[c+1]-p[a+1],cz=p[c+2]-p[a+2],dx=p[d]-p[a],dy=p[d+1]-p[a+1],dz=p[d+2]-p[a+2];
        const b0=(cy*dz-cz*dy)/6,b1=(cz*dx-cx*dz)/6,b2=(cx*dy-cy*dx)/6,c0=(dy*bz-dz*by)/6,c1=(dz*bx-dx*bz)/6,c2=(dx*by-dy*bx)/6,d0=(by*cz-bz*cy)/6,d1=(bz*cx-bx*cz)/6,d2=(bx*cy-by*cx)/6,a0=-b0-c0-d0,a1=-b1-c1-d1,a2=-b2-c2-d2;
        const denom=w[ia]*(a0*a0+a1*a1+a2*a2)+w[ib]*(b0*b0+b1*b1+b2*b2)+w[ic]*(c0*c0+c1*c1+c2*c2)+w[id]*(d0*d0+d1*d1+d2*d2)+volumeAlpha;
        const dl=(-(bx*b0+by*b1+bz*b2-vols[t])-volumeAlpha*vl[t])/Math.max(denom,1e-14);vl[t]+=dl;
        const sa=dl*w[ia],sb=dl*w[ib],sc=dl*w[ic],sd=dl*w[id];
        p[a]+=a0*sa;p[a+1]+=a1*sa;p[a+2]+=a2*sa;p[b]+=b0*sb;p[b+1]+=b1*sb;p[b+2]+=b2*sb;p[c]+=c0*sc;p[c+1]+=c1*sc;p[c+2]+=c2*sc;p[d]+=d0*sd;p[d+1]+=d1*sd;p[d+2]+=d2*sd;
      }
      if(grab?.ids&&grab.target){
        const target=xyz(grab.target),rotation=grab.rotation;
        for(let k=0;k<grab.ids.length;k++){const i=grab.ids[k],j=i*3;if(!w[i])continue;let ox=grab.offsets[k*3],oy=grab.offsets[k*3+1],oz=grab.offsets[k*3+2];if(rotation)[ox,oy,oz]=rotate(rotation,ox,oy,oz);
          const strength=clamp((grab.strength??.42)*grab.weights[k],0,.95),dx=target[0]+ox-p[j],dy=target[1]+oy-p[j+1],dz=target[2]+oz-p[j+2],scale=Math.min(strength,(grab.maxCorrection??.13)/(Math.hypot(dx,dy,dz)+1e-9));p[j]+=dx*scale;p[j+1]+=dy*scale;p[j+2]+=dz*scale;
        }
      }
      if(knife){
        const kp=xyz(knife.point),kn=xyz(knife.normal??{x:0,y:0,z:1}),radius=knife.radius??.25,halfLength=knife.halfLength??Infinity,edgeY=knife.edgeY??kp[1],strength=knife.strength??.6;
        for(let i=0;i<n;i++){const j=i*3,dx=p[j]-kp[0],dz=p[j+2]-kp[2],distance=Math.abs(dx*kn[0]+dz*kn[2]),along=Math.abs(dx*kn[2]-dz*kn[0]);if(distance<radius&&along<halfLength&&p[j+1]>edgeY){const weight=(1-distance/radius)**2;p[j+1]-=Math.min(.13,(p[j+1]-edgeY)*weight*strength)}}
      }
      // Each contact is a half-space: dot(position,normal) >= offset.
      if(contacts)for(const plane of contacts){const normal=xyz(plane.normal),offset=plane.offset??0;for(let i=0;i<n;i++){const j=i*3,d=p[j]*normal[0]+p[j+1]*normal[1]+p[j+2]*normal[2]-offset;if(d<0){p[j]-=d*normal[0];p[j+1]-=d*normal[1];p[j+2]-=d*normal[2]}}}
      if(Number.isFinite(floor))for(let i=0;i<n;i++)if(p[i*3+1]<floor)p[i*3+1]=floor;
    }
    const floorDrag=Math.exp(-friction*dt);
    for(let i=0;i<n;i++){
      const j=i*3,impactY=v[j+1];
      for(let k=0;k<3;k++)v[j+k]=(p[j+k]-old[j+k])/dt;
      if(p[j+1]<=floor+.002){v[j]*=floorDrag;v[j+2]*=floorDrag;if(impactY<-.5&&v[j+1]<0)v[j+1]=-impactY*restitution;else if(v[j+1]<0)v[j+1]=0}
    }
    // Relative longitudinal edge velocities exclude rigid translation and rigid
    // rotation. Pair impulses conserve the solver's linear/angular momentum.
    const internalDamping=1-Math.exp(-clamp(damping,0,1)*24*dt);
    if(internalDamping>0)for(let e=0;e<lengths.length;e++){
      const ia=ids[e*2],ib=ids[e*2+1],a=ia*3,b=ib*3,dx=p[b]-p[a],dy=p[b+1]-p[a+1],dz=p[b+2]-p[a+2],l2=dx*dx+dy*dy+dz*dz;
      const impulse=((v[b]-v[a])*dx+(v[b+1]-v[a+1])*dy+(v[b+2]-v[a+2])*dz)*internalDamping/(Math.max(l2,1e-12)*(w[ia]+w[ib]||1)),sa=impulse*w[ia],sb=impulse*w[ib];
      v[a]+=dx*sa;v[a+1]+=dy*sa;v[a+2]+=dz*sa;v[b]-=dx*sb;v[b+1]-=dy*sb;v[b+2]-=dz*sb;
    }
    return this;
  }

  volume(){let v=0;for(let t=0;t<this.tetrahedra.length;t+=4)v+=det(this.positions,this.tetrahedra[t],this.tetrahedra[t+1],this.tetrahedra[t+2],this.tetrahedra[t+3])/6;return v}
  metrics(){let kinetic=0,inverted=0,minY=Infinity;for(let i=0;i<this.count;i++){const j=i*3;kinetic+=this.masses[i]*(this.velocities[j]**2+this.velocities[j+1]**2+this.velocities[j+2]**2)/2;minY=Math.min(minY,this.positions[j+1])}for(let t=0;t<this.tetrahedra.length;t+=4)if(det(this.positions,...this.tetrahedra.subarray(t,t+4))<0)inverted++;return{particles:this.count,tetrahedra:this.restVolumes.length,volume:this.volume(),restVolume:this.restVolume,volumeRatio:this.volume()/this.restVolume,kinetic,inverted,minY}}

  /** Best-fit rotation without adding any upright restoring force to the solver. */
  getPose(){
    const center=this.center(),r=this.restCenter,p=this.positions,s=this.rest,A=new Float64Array(9);
    for(let i=0;i<this.count;i++){const j=i*3,m=this.masses[i],x=p[j]-center.x,y=p[j+1]-center.y,z=p[j+2]-center.z,rx=s[j]-r.x,ry=s[j+1]-r.y,rz=s[j+2]-r.z;A[0]+=m*x*rx;A[1]+=m*y*rx;A[2]+=m*z*rx;A[3]+=m*x*ry;A[4]+=m*y*ry;A[5]+=m*z*ry;A[6]+=m*x*rz;A[7]+=m*y*rz;A[8]+=m*z*rz}
    // Horn's symmetric quaternion matrix plus Jacobi eigenvectors also handles
    // an exact 180-degree inversion (iterative rotation fitting can stall there).
    const trace=A[0]+A[4]+A[8],x=A[5]-A[7],y=A[6]-A[2],z=A[1]-A[3],xy=A[1]+A[3],xz=A[2]+A[6],yz=A[5]+A[7];
    const N=new Float64Array([trace,x,y,z,x,A[0]-A[4]-A[8],xy,xz,y,xy,-A[0]+A[4]-A[8],yz,z,xz,yz,-A[0]-A[4]+A[8]]),V=new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    for(let iteration=0;iteration<40;iteration++){
      let a=0,b=1,max=0;for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)if(Math.abs(N[i*4+j])>max){max=Math.abs(N[i*4+j]);a=i;b=j}if(max<1e-12)break;
      const ab=N[a*4+b],tau=(N[b*4+b]-N[a*4+a])/(2*ab),t=(tau<0?-1:1)/(Math.abs(tau)+Math.sqrt(1+tau*tau)),c=1/Math.sqrt(1+t*t),s=t*c;
      N[a*4+a]-=t*ab;N[b*4+b]+=t*ab;N[a*4+b]=N[b*4+a]=0;
      for(let k=0;k<4;k++){
        if(k!==a&&k!==b){const ka=N[k*4+a],kb=N[k*4+b];N[k*4+a]=N[a*4+k]=c*ka-s*kb;N[k*4+b]=N[b*4+k]=s*ka+c*kb}
        const va=V[k*4+a],vb=V[k*4+b];V[k*4+a]=c*va-s*vb;V[k*4+b]=s*va+c*vb;
      }
    }
    let best=0;for(let i=1;i<4;i++)if(N[i*4+i]>N[best*4+best])best=i;
    const q={w:V[best],x:V[4+best],y:V[8+best],z:V[12+best]},previous=this._poseQuaternion;
    if(q.x*previous.x+q.y*previous.y+q.z*previous.z+q.w*previous.w<0){q.x=-q.x;q.y=-q.y;q.z=-q.z;q.w=-q.w}
    this._poseQuaternion=q;return{center,quaternion:{...q},restCenter:{...r}};
  }
  worldToRest(point,out){const p=xyz(point),pose=this.getPose(),q=pose.quaternion,[x,y,z]=rotate({x:-q.x,y:-q.y,z:-q.z,w:q.w},p[0]-pose.center.x,p[1]-pose.center.y,p[2]-pose.center.z);return write(out,x+pose.restCenter.x,y+pose.restCenter.y,z+pose.restCenter.z)}
}

export default SoftBody;
