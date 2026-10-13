import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {sessionId, CleanBot} from '../src/worker.js';
import {notion} from '../src/notion.js';
test('webhook accepts Notion page payload but rejects arbitrary IDs',()=>{
 assert.equal(sessionId({data:{id:'11111111-1111-4111-8111-111111111111'}}),'11111111111141118111111111111111');
 assert.throws(()=>sessionId({id:'../../x'}));
});
test('webhook refuses missing or incorrect authentication before accessing state',async()=>{
 const r=await worker.fetch(new Request('https://test/draw',{method:'POST',body:'{}'}),{WEBHOOK_SECRET:'secret',NOTION_TOKEN:'test'});
 assert.equal(r.status,401);
});
test('query retrieves every page',async()=>{
 const requests=[];
 const api=notion('test',async(url,options)=>{requests.push(JSON.parse(options.body));return Response.json(requests.length===1?{results:[{id:1}],has_more:true,next_cursor:'next'}:{results:[{id:2}],has_more:false});});
 assert.deepEqual(await api.query('source'),[{id:1},{id:2}]); assert.equal(requests[1].start_cursor,'next');
});
test('persisted draw resumes identical roles after partial failure',async()=>{
 const id='11111111111141118111111111111111',member='a'.repeat(32),row='b'.repeat(32);
 const bot=new CleanBot({storage:{put:async()=>{}}},{SESSIONS_DATA_SOURCE:'c'.repeat(32)});
 let fail=true;const saved=[];
 bot.api={page:async target=>target===id?{parent:{data_source_id:'c'.repeat(32)},properties:{'진행 상태':{select:{name:'추첨 중'}}}}:{properties:{'출결':{select:{name:'출석'}},'구성원':{relation:[{id:member}]},'회차':{relation:[{id}]}}},patch:async(target,props)=>{if(target===member&&fail){fail=false;throw Error('temporary outage');}saved.push({target,props});}};
 const job={id,action:'draw',snapshot:[{row,member,attendance:'출석',roles:['청소기 A'],probability:.25}],index:0};
 await assert.rejects(()=>bot.step(job,'key')); assert.equal(job.index,0);
 await bot.step(job,'key'); assert.equal(job.index,1);
 assert.deepEqual(saved.filter(x=>x.target===row).map(x=>x.props['역할']),Array(2).fill({multi_select:[{name:'청소기 A'}]}));
 await bot.step(job,'key'); assert.equal(job.done,true);
});
test('completed webhook cannot enqueue a new draw',async()=>{
 const bot=new CleanBot({blockConcurrencyWhile:fn=>fn(),storage:{get:async()=>({done:true})}},{});
 const r=await bot.fetch(new Request('https://internal/draw',{method:'POST',body:JSON.stringify({id:'a'.repeat(32)})}));
 assert.equal((await r.json()).status,'already_completed');
});
