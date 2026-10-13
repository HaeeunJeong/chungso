import {draw, weight} from './draw.js';
import {notion, cleanId, select, rich, name, choice, related} from './notion.js';
export function sessionId(body){const id=cleanId(body.session_id || body.data?.id);if(!/^[a-f0-9]{32}$/i.test(id))throw new Error('청소 회차 page ID가 필요합니다.');return id.toLowerCase();}
export default {
 async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/health')return Response.json({service:'clean-bot',configured:!!(env.NOTION_TOKEN&&env.WEBHOOK_SECRET)});
  if(request.method!=='POST'||!['/prepare','/draw'].includes(path))return new Response('Not found',{status:404});
  if(!env.NOTION_TOKEN||!env.WEBHOOK_SECRET)return new Response('Secrets not configured',{status:503});
  if(request.headers.get('x-cleanbot-key')!==env.WEBHOOK_SECRET)return new Response('Unauthorized',{status:401});
  const raw=await request.text();if(raw.length>100000)return new Response('Payload too large',{status:413});
  let id;try{id=sessionId(JSON.parse(raw));}catch{return new Response('Invalid session ID',{status:400});}
  return env.CLEAN_BOT.get(env.CLEAN_BOT.idFromName('lab')).fetch(new Request('https://internal'+path,{method:'POST',body:JSON.stringify({id})}));
 }
};
// One durable queue serializes all draws, including across different rounds.
// Each alarm writes at most one participant, keeping requests short.
export class CleanBot {
 constructor(state,env){this.state=state;this.env=env;this.api=notion(env.NOTION_TOKEN, fetch, env.RECORDS_DATA_SOURCE);}
 async fetch(request){return this.state.blockConcurrencyWhile(async()=>{
  const {id}=await request.json(),action=new URL(request.url).pathname.slice(1),key=action+':'+id;
  const old=await this.state.storage.get(key);
  if(old?.done)return Response.json({status:'already_completed'});
  const queue=await this.state.storage.get('queue')||[];
  if(!queue.includes(key))queue.push(key);
  await this.state.storage.put(key,{...old,id,action,attempts:0});
  await this.state.storage.put('queue',queue);
  await this.state.storage.setAlarm(Date.now()+1000);
  return Response.json({status:'accepted',message:'결과는 Notion 청소 회차에서 확인하세요.'},{status:202});
 });}
 async alarm(){return this.state.blockConcurrencyWhile(async()=>{
  const queue=await this.state.storage.get('queue')||[];if(!queue.length)return;
  const key=queue[0],job=await this.state.storage.get(key);
  try{
   await this.step(job,key);job.attempts=0;
   if(job.done)queue.shift();
  }catch(error){
   job.attempts=(job.attempts||0)+1;job.error=String(error.message).slice(0,300);
   // Only report to a validated page in our configured sessions database.
   if(job.validated)try{await this.api.patch(job.id,{'메모':rich('처리 보류: '+job.error+' / 입력을 수정한 뒤 같은 버튼을 눌러 재시도하세요.')});}catch{}
   if(job.attempts>=4)queue.shift();
  }
  await this.state.storage.put(key,job);await this.state.storage.put('queue',queue);
  if(queue.length)await this.state.storage.setAlarm(Date.now()+(job.attempts?15000:1000));
 });}
 async step(job,key){
  const MEMBERS=this.env.MEMBERS_DATA_SOURCE, SESSIONS=this.env.SESSIONS_DATA_SOURCE, RECORDS=this.env.RECORDS_DATA_SOURCE;
  const api=this.api,session=await api.page(job.id);
  if(cleanId(session.parent?.data_source_id)!==cleanId(SESSIONS)||session.archived||session.in_trash)throw new Error('청소 회차 데이터베이스의 활성 페이지만 처리할 수 있습니다.');
  job.validated=true;
  const status=choice(session,'진행 상태');
  if(status==='취소')throw new Error('취소된 회차입니다.');
  if(status==='확정') {if(job.action==='draw'&&job.snapshot){job.done=true;return;}throw new Error('확정된 회차는 다시 추첨하지 않습니다.');}
  if(job.action==='prepare'){
   if(status!=='출결 입력')throw new Error('진행 상태를 출결 입력으로 설정하세요.');
   if(!job.members){
    const members=await api.query(MEMBERS,{property:'등록 상태',select:{equals:'활동'}});
    if(!members.length||members.length>80)throw new Error('활동 구성원은 1~80명이어야 합니다.');
    job.members=members.map(p=>({id:p.id,name:name(p)}));job.index=0;
    await this.state.storage.put(key,job);
   }
   if(job.index<job.members.length){
    const m=job.members[job.index];
    const rows=await api.query(RECORDS,{and:[{property:'회차',relation:{contains:job.id}},{property:'구성원',relation:{contains:m.id}}]});
    if(rows.length>1)throw new Error('한 회차에 같은 구성원의 기록이 중복되었습니다.');
    if(!rows.length)await api.create({'기록':{title:[{text:{content:m.name+' · 출결'}}]},'구성원':{relation:[{id:m.id}]},'회차':{relation:[{id:job.id}]},'확률 계산 상태':select('미계산')});
    job.index++;return;
   }
   await api.patch(job.id,{'메모':rich('출결 입력 준비 완료. 모든 구성원의 출석·도망·부재를 지정한 뒤 청소 시작! 버튼을 누르세요.')});job.done=true;return;
  }
  if(!job.snapshot){
   if(status!=='출결 입력')throw new Error('출결 입력 상태에서 시작하세요.');
   const rows=await api.query(RECORDS,{property:'회차',relation:{contains:job.id}});
   const members=await api.query(MEMBERS,{property:'등록 상태',select:{equals:'활동'}});
   const active=new Set(members.map(p=>cleanId(p.id))),seen=new Set();
   for(const r of rows){
    const ids=related(r,'구성원');
    if(ids.length!==1||related(r,'회차').length!==1||!active.has(ids[0])||seen.has(ids[0]))throw new Error('출결은 활동 구성원당 한 행, 구성원·회차는 각각 한 개여야 합니다.');
    seen.add(ids[0]);if(!['출석','도망','부재'].includes(choice(r,'출결')))throw new Error('모든 구성원의 출결을 선택하세요.');
   }
   if(seen.size!==active.size)throw new Error('누락된 활동 구성원의 출결을 추가하세요.');
   const sessions=await api.query(SESSIONS,{property:'진행 상태',select:{equals:'확정'}});
   const confirmed=new Set(sessions.map(p=>cleanId(p.id)));
   const history=await api.query(RECORDS);
   const counts=new Map(),historyKeys=new Set();
   for(const r of history){
    const rounds=related(r,'회차'),ids=related(r,'구성원');
    if(rounds.length!==1||!confirmed.has(rounds[0]))continue;
    if(ids.length!==1)throw new Error('확정 기록의 구성원 연결을 확인하세요.');
    const hkey=rounds[0]+':'+ids[0];if(historyKeys.has(hkey))throw new Error('확정 기록에 중복 출결이 있습니다.');historyKeys.add(hkey);
    const c=counts.get(ids[0])||[0,0];if(choice(r,'출결')==='출석')c[0]++;else if(choice(r,'출결')==='도망')c[1]++;counts.set(ids[0],c);
   }
   const present=rows.filter(r=>choice(r,'출결')==='출석');
   const result=draw(present.map(r=>({id:r.id,weight:weight(...(counts.get(related(r,'구성원')[0])||[0,0]))})));
   job.snapshot=rows.map(r=>({row:r.id,member:related(r,'구성원')[0],attendance:choice(r,'출결'),...(result.find(x=>x.id===r.id)||{probability:0,roles:[]})}));job.index=0;
   // Persist randomness before any Notion result write. Retry never rerolls.
   await this.state.storage.put(key,job);
   await api.patch(job.id,{'진행 상태':select('추첨 중'),'메모':rich('추첨 결과 저장 중입니다. 출결과 역할을 수정하지 마세요. 실패 시 같은 버튼으로 이어서 저장합니다.')});return;
  }
  if(job.index<job.snapshot.length){
   const row=job.snapshot[job.index],current=await api.page(row.row);
   if(current.archived||current.in_trash||choice(current,'출결')!==row.attendance||related(current,'구성원').join()!==row.member||related(current,'회차').join()!==job.id)throw new Error('추첨 이후 출결/연결이 변경되었습니다. 원래 값으로 복원한 뒤 재시도하세요.');
   await api.patch(row.row,{'역할':{multi_select:row.roles.map(name=>({name}))},'깍두기 확률':{number:row.probability},'확률 계산 상태':select('계산 완료')});
   await api.patch(row.member,{'깍두기 확률 안내':rich((row.attendance==='출석'?(row.probability*100).toFixed(1)+'%':'참여 대상 아님')+' · 최근 추첨 회차 '+job.id+' · 추첨 전 확률')});
   job.index++;return;
  }
  await api.patch(job.id,{'진행 상태':select('확정'),'메모':rich('추첨 완료. 출결·역할 기록에서 결과를 확인하세요. 깍두기 확률은 이번 추첨 직전 기준입니다.')});job.done=true;
 }
}
