import test from 'node:test';
import assert from 'node:assert/strict';
import { draw, probabilities, weight, ROLES } from '../src/draw.js';
test('attendance reward excludes justified absence and smooths new members',()=>{
 assert.equal(weight(0,0),2); assert.ok(weight(10,0)>weight(5,5));
});
test('exact subset marginals for two of three',()=>{
 const p=probabilities([1,2,3],2);
 [5/11,8/11,9/11].forEach((x,i)=>assert.ok(Math.abs(p[i]-x)<1e-10));
});
test('every role exactly once and excess people rest',()=>{
 for(let n=1;n<=30;n++){
  const people=Array.from({length:n},(_,i)=>({id:String(i),weight:1+i/30}));
  const a=draw(people);
  assert.deepEqual(a.flatMap(x=>x.roles).filter(x=>x!=='깍두기').sort(),[...ROLES].sort());
  assert.equal(a.filter(x=>x.roles.includes('깍두기')).length,Math.max(0,n-8));
  assert.equal(a.length,n); assert.ok(a.every(x=>x.roles.length));
  assert.ok(Math.abs(a.reduce((s,x)=>s+x.probability,0)-Math.max(0,n-8))<1e-8);
 }
});
test('equal attendance gives equal rest probability',()=>{
 probabilities(Array(10).fill(2),2).forEach(p=>assert.ok(Math.abs(p-.2)<1e-10));
});
test('invalid and duplicate participants fail',()=>{
 assert.throws(()=>draw([])); assert.throws(()=>draw([{id:'a',weight:1},{id:'a',weight:1}]));
 assert.throws(()=>draw([{id:'a',weight:NaN}]));
});
