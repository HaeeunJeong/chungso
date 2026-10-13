export const ROLES = ['청소기 A','청소기 B','물걸레 A','물걸레 B','큰쓰레기 + 책상·모니터 먼지 제거','공기청정기 필터 청소','식탁 정리','신발장 정리'];
export const weight = (attended, escaped) => 1 + 2 * (attended + 1) / (attended + escaped + 2);
const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
function coefficients(w,k) {
 const e=Array(k+1).fill(0); e[0]=1;
 for(const v of w) for(let j=k;j>0;j--) e[j]+=v*e[j-1];
 return e;
}
export function probabilities(w,k) {
 if(k===0) return w.map(()=>0);
 const z=coefficients(w,k)[k];
 return w.map((v,i)=>v*coefficients(w.filter((_,j)=>j!==i),k-1)[k-1]/z);
}
export function draw(people, rng=random) {
 if(!people.length || people.length>80 || new Set(people.map(x=>x.id)).size!==people.length || people.some(x=>!x.id || !Number.isFinite(x.weight) || x.weight<=0 || x.weight>3)) throw new Error('참여자는 중복 없이 1~80명이어야 합니다.');
 const w=people.map(x=>x.weight), k=Math.max(0,people.length-8), p=probabilities(w,k);
 const rest=new Set(); let remaining=k;
 for(let i=0;i<w.length && remaining;i++) {
  const tail=coefficients(w.slice(i+1),remaining);
  const chance=w[i]*tail[remaining-1]/(tail[remaining]+w[i]*tail[remaining-1]);
  if(rng()<chance){rest.add(i);remaining--;}
 }
 const working=people.map((_,i)=>i).filter(i=>!rest.has(i));
 for(let i=working.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[working[i],working[j]]=[working[j],working[i]];}
 const result=people.map((x,i)=>({id:x.id,probability:p[i],roles:rest.has(i)?['깍두기']:[]}));
 ROLES.forEach((role,i)=>result[working[i%working.length]].roles.push(role));
 return result;
}
