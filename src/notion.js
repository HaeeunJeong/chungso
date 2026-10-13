export const cleanId=id=>String(id||'').replaceAll('-','');
export const select=name=>({select:{name}});
export const rich=text=>({rich_text:[{text:{content:text}}]});
export const name=p=>(p.properties['이름']?.title||[]).map(x=>x.plain_text ?? x.text?.content ?? '').join('');
export const choice=(p,key)=>p.properties[key]?.select?.name;
export const related=(p,key)=>(p.properties[key]?.relation||[]).map(x=>cleanId(x.id));
export function notion(token, transport=fetch, recordsSource) {
 async function call(path,method='GET',body) {
  const r=await transport('https://api.notion.com/v1/'+path,{method,headers:{Authorization:`Bearer ${token}`,'Notion-Version':'2025-09-03','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(8000)});
  if(!r.ok) throw new Error(`Notion API ${r.status}: 연결 권한·속성·요청 제한을 확인하세요.`);
  return r.json();
 }
 return {
  page:id=>call('pages/'+id),
  patch:(id,properties)=>call('pages/'+id,'PATCH',{properties}),
  create:properties=>call('pages','POST',{parent:{type:'data_source_id',data_source_id:recordsSource},properties}),
  async query(id,filter){let rows=[],cursor;do{const r=await call('data_sources/'+id+'/query','POST',{page_size:100,...(filter?{filter}:{}),...(cursor?{start_cursor:cursor}:{})});rows.push(...r.results);cursor=r.has_more?r.next_cursor:null;if(r.has_more&&!cursor)throw new Error('페이지네이션 오류');}while(cursor);return rows;}
 };
}
